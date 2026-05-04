'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { sanitizeSvg } from '@/lib/utils/svg-sanitize';

// MIME type map for extension validation
const EXTENSION_MIME_MAP: Record<string, string[]> = {
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  svg: ['image/svg+xml'],
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  txt: ['text/plain'],
  csv: ['text/csv', 'application/csv'],
  md: ['text/markdown', 'text/plain'],
  zip: ['application/zip', 'application/x-zip-compressed'],
  rar: ['application/vnd.rar', 'application/x-rar-compressed'],
  '7z': ['application/x-7z-compressed'],
  'tar.gz': ['application/gzip', 'application/x-gzip'],
};

function getFileExtension(filename: string): string {
  if (filename.toLowerCase().endsWith('.tar.gz')) return 'tar.gz';
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

function sanitizeFilename(filename: string): string {
  // Keep only safe characters
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

export type AttachmentActionState = {
  error?: string;
};

export async function uploadAttachments(
  _prev: AttachmentActionState,
  formData: FormData,
): Promise<AttachmentActionState> {
  const supabase = await createServerClient();

  // Auth check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, is_blocked')
    .eq('id', user.id)
    .single();

  if (!profile) return { error: 'Profile not found.' };
  if (profile.is_blocked) return { error: 'Your account has been blocked.' };

  const postId = formData.get('post_id') as string;
  if (!postId) return { error: 'Post ID is required.' };

  // Fetch the post (RLS check ensures user has access)
  const { data: post } = await supabase
    .from('posts')
    .select('id, ticket_id, author_id')
    .eq('id', postId)
    .single();

  if (!post) return { error: 'Post not found.' };

  // Permission: only post author or agent can upload
  const isAgent = profile.role === 'agent' || profile.role === 'admin';
  if (post.author_id !== user.id && !isAgent) {
    return { error: 'You do not have permission to upload to this post.' };
  }

  // Fetch the ticket to get slug for revalidation
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug')
    .eq('id', post.ticket_id)
    .single();

  if (!ticket) return { error: 'Ticket not found.' };

  // Get file upload settings
  const [allowedTypesRes, maxSizeRes, maxFilesRes] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'allowed_file_types').single(),
    supabase.from('app_settings').select('value').eq('key', 'max_file_size_mb').single(),
    supabase.from('app_settings').select('value').eq('key', 'max_files_per_post').single(),
  ]);

  let allowedTypes: string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'txt'];
  if (allowedTypesRes.data) {
    try {
      allowedTypes = JSON.parse(allowedTypesRes.data.value);
    } catch { /* use defaults */ }
  }
  const parsedMaxSize = maxSizeRes.data ? parseInt(maxSizeRes.data.value, 10) : NaN;
  let maxSizeMb = Number.isFinite(parsedMaxSize) && parsedMaxSize > 0 ? parsedMaxSize : 10;
  const parsedMaxFiles = maxFilesRes.data ? parseInt(maxFilesRes.data.value, 10) : NaN;
  let maxFilesPerPost = Number.isFinite(parsedMaxFiles) && parsedMaxFiles > 0 ? parsedMaxFiles : 5;

  // Check tier overrides for file limits
  const { data: tierProfile } = await supabase
    .from('profiles')
    .select('tier_id, tier_expires_at')
    .eq('id', user.id)
    .single();

  if (tierProfile?.tier_id) {
    const tierActive = !tierProfile.tier_expires_at || new Date(tierProfile.tier_expires_at) > new Date();
    if (tierActive) {
      const { data: tier } = await supabase
        .from('subscription_tiers')
        .select('limit_max_file_size, limit_max_files_per_post')
        .eq('id', tierProfile.tier_id)
        .single();
      if (tier?.limit_max_file_size != null) {
        // Tier stores bytes; convert to MB, cap at 50MB
        const tierMb = Math.min(tier.limit_max_file_size / (1024 * 1024), 50);
        if (tierMb > maxSizeMb) maxSizeMb = tierMb;
      }
      if (tier?.limit_max_files_per_post != null) {
        const tierFiles = Math.min(tier.limit_max_files_per_post, 20);
        if (tierFiles > maxFilesPerPost) maxFilesPerPost = tierFiles;
      }
    }
  }

  const maxSizeBytes = maxSizeMb * 1024 * 1024;

  // Get files from formData
  const files = formData.getAll('files') as File[];
  if (!files || files.length === 0) return { error: 'No files selected.' };

  // Check existing attachment count
  const { count: existingCount } = await supabase
    .from('attachments')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId);

  const totalFiles = (existingCount ?? 0) + files.length;
  if (totalFiles > maxFilesPerPost) {
    return { error: `Maximum ${maxFilesPerPost} files per post. Currently ${existingCount ?? 0} attached.` };
  }

  // Validate each file
  for (const file of files) {
    if (file.name.length > 255) {
      return { error: `Filename "${file.name.slice(0, 50)}…" exceeds the 255-character limit.` };
    }
    const ext = getFileExtension(file.name);
    if (!allowedTypes.includes(ext)) {
      return { error: `File type ".${ext}" is not allowed. Allowed: ${allowedTypes.join(', ')}` };
    }
    if (file.size > maxSizeBytes) {
      return { error: `File "${file.name}" exceeds the ${maxSizeMb}MB limit.` };
    }
    // MIME type validation
    const expectedMimes = EXTENSION_MIME_MAP[ext];
    if (expectedMimes && !expectedMimes.includes(file.type) && file.type !== 'application/octet-stream') {
      return { error: `File "${file.name}" has mismatched type (expected ${expectedMimes.join('/')}, got ${file.type}).` };
    }
  }

  // Upload each file
  for (const file of files) {
    const ext = getFileExtension(file.name);
    const uuid = crypto.randomUUID();
    const safeName = sanitizeFilename(file.name);
    const storagePath = `tickets/${ticket.id}/posts/${postId}/${uuid}-${safeName}`;

    let fileBuffer: Uint8Array = new Uint8Array(await file.arrayBuffer());

    // SVG sanitization
    if (ext === 'svg') {
      fileBuffer = await sanitizeSvg(fileBuffer);
    }

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return { error: `Failed to upload "${file.name}": ${uploadError.message}` };
    }

    // Insert attachment record
    const { error: insertError } = await supabase
      .from('attachments')
      .insert({
        post_id: postId,
        uploader_id: user.id,
        storage_path: storagePath,
        original_filename: file.name,
        file_size: file.size,
        mime_type: file.type,
      });

    if (insertError) {
      // Clean up uploaded file
      await supabase.storage.from('attachments').remove([storagePath]);
      return { error: `Failed to save attachment record: ${insertError.message}` };
    }

    // Log activity
    await supabase.from('activity_log').insert({
      ticket_id: ticket.id,
      actor_id: user.id,
      action: 'file_uploaded',
      details: { filename: file.name, post_id: postId },
    });
  }

  revalidatePath(`/tickets/${ticket.id}/${ticket.slug}`);
  return {};
}

export async function deleteAttachment(formData: FormData): Promise<void> {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile) return;

  const attachmentId = formData.get('attachment_id') as string;
  if (!attachmentId) return;

  // Fetch attachment
  const { data: attachment } = await supabase
    .from('attachments')
    .select('id, post_id, storage_path, original_filename')
    .eq('id', attachmentId)
    .single();

  if (!attachment) return;

  // Fetch parent post
  const { data: post } = await supabase
    .from('posts')
    .select('id, author_id, ticket_id')
    .eq('id', attachment.post_id)
    .single();

  if (!post) return;

  // Permission: post author or agent
  const isAgent = profile.role === 'agent' || profile.role === 'admin';
  if (post.author_id !== user.id && !isAgent) return;

  // Delete from storage first so we don't orphan the DB row on failure
  const { error: storageDeleteError } = await supabase.storage
    .from('attachments')
    .remove([attachment.storage_path]);

  if (storageDeleteError) {
    console.error(`Failed to delete attachment from storage: ${storageDeleteError.message}`);
    return; // Don't delete the DB row if storage cleanup failed
  }

  // Delete record only after the storage object was removed successfully
  const { error: attachmentDeleteError } = await supabase
    .from('attachments')
    .delete()
    .eq('id', attachmentId);

  if (attachmentDeleteError) {
    console.error(`Failed to delete attachment record: ${attachmentDeleteError.message}`);
    return;
  }

  // Log activity
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug')
    .eq('id', post.ticket_id)
    .single();

  if (ticket) {
    await supabase.from('activity_log').insert({
      ticket_id: ticket.id,
      actor_id: user.id,
      action: 'file_deleted',
      details: { filename: attachment.original_filename, post_id: post.id },
    });

    revalidatePath(`/tickets/${ticket.id}/${ticket.slug}`);
  }
}

export async function getAttachmentUrl(attachmentId: string): Promise<string | null> {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Fetch attachment (RLS on attachments inherits post visibility)
  const { data: attachment } = await supabase
    .from('attachments')
    .select('id, storage_path')
    .eq('id', attachmentId)
    .single();

  if (!attachment) return null;

  // Generate signed URL (1 hour expiry)
  const { data } = await supabase.storage
    .from('attachments')
    .createSignedUrl(attachment.storage_path, 3600);

  return data?.signedUrl ?? null;
}

// ===========================================================================
// Inline image upload (paste / drop / toolbar inside the Markdown editor)
// ---------------------------------------------------------------------------
// Uploads a single image to Storage *before* the parent post exists,
// recording an "orphan" attachment row (post_id IS NULL, uploader_id = user).
// The returned URL embeds the attachment id as a query parameter (&att=...);
// `claimInlineAttachments(postId, body)` later finds those ids in a saved
// post body and links the rows to the new post.
// ===========================================================================

// Allowed image extensions for inline embedding. These are the file types the
// Markdown editor can render via the <img> tag.
const INLINE_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

export type InlineImageUploadResult =
  | { url: string; attachmentId: string; error?: undefined }
  | { error: string; url?: undefined; attachmentId?: undefined };

export async function uploadInlineImage(
  formData: FormData,
): Promise<InlineImageUploadResult> {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, is_blocked')
    .eq('id', user.id)
    .single();
  if (!profile) return { error: 'Profile not found.' };
  if (profile.is_blocked) return { error: 'Your account has been blocked.' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { error: 'No file provided.' };

  if (file.name.length > 255) {
    return { error: 'Filename exceeds the 255-character limit.' };
  }
  const ext = getFileExtension(file.name);
  if (!INLINE_IMAGE_EXTENSIONS.includes(ext)) {
    return { error: `Only image files can be embedded (got .${ext || 'unknown'}).` };
  }
  if (!file.type.startsWith('image/')) {
    return { error: `File "${file.name}" is not an image.` };
  }
  const expectedMimes = EXTENSION_MIME_MAP[ext];
  if (expectedMimes && !expectedMimes.includes(file.type)) {
    return { error: `File "${file.name}" has mismatched type (expected ${expectedMimes.join('/')}, got ${file.type}).` };
  }

  // Honour the configured max file size (with tier override) and a 50MB hard cap.
  const { data: maxSizeRes } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'max_file_size_mb')
    .single();
  const parsedMaxSize = maxSizeRes ? parseInt(maxSizeRes.value, 10) : NaN;
  let maxSizeMb = Number.isFinite(parsedMaxSize) && parsedMaxSize > 0 ? parsedMaxSize : 10;

  const { data: tierProfile } = await supabase
    .from('profiles')
    .select('tier_id, tier_expires_at')
    .eq('id', user.id)
    .single();
  if (tierProfile?.tier_id) {
    const tierActive = !tierProfile.tier_expires_at || new Date(tierProfile.tier_expires_at) > new Date();
    if (tierActive) {
      const { data: tier } = await supabase
        .from('subscription_tiers')
        .select('limit_max_file_size')
        .eq('id', tierProfile.tier_id)
        .single();
      if (tier?.limit_max_file_size != null) {
        const tierMb = Math.min(tier.limit_max_file_size / (1024 * 1024), 50);
        if (tierMb > maxSizeMb) maxSizeMb = tierMb;
      }
    }
  }

  const maxSizeBytes = maxSizeMb * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return { error: `Image "${file.name}" exceeds the ${maxSizeMb}MB limit.` };
  }

  const uuid = crypto.randomUUID();
  const safeName = sanitizeFilename(file.name);
  const storagePath = `inline/${user.id}/${uuid}-${safeName}`;

  let fileBuffer: Uint8Array = new Uint8Array(await file.arrayBuffer());
  if (ext === 'svg') {
    fileBuffer = await sanitizeSvg(fileBuffer);
  }

  const { error: uploadError } = await supabase.storage
    .from('attachments')
    .upload(storagePath, fileBuffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    return { error: `Failed to upload image: ${uploadError.message}` };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('attachments')
    .insert({
      post_id: null,
      uploader_id: user.id,
      storage_path: storagePath,
      original_filename: file.name,
      file_size: file.size,
      mime_type: file.type,
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    await supabase.storage.from('attachments').remove([storagePath]);
    return { error: `Failed to record attachment: ${insertError?.message ?? 'unknown error'}` };
  }

  const { data: signed } = await supabase.storage
    .from('attachments')
    .createSignedUrl(storagePath, 60 * 60 * 24); // 24h — long enough to draft
  if (!signed?.signedUrl) {
    return { error: 'Failed to generate signed URL.' };
  }

  // Embed the attachment id in the URL so claimInlineAttachments() can find
  // and re-parent the row once the post is saved.
  const sep = signed.signedUrl.includes('?') ? '&' : '?';
  const url = `${signed.signedUrl}${sep}att=${inserted.id}`;

  return { url, attachmentId: inserted.id };
}

/**
 * Find inline-image attachment ids referenced in `body` and re-parent the
 * matching orphan rows onto `postId`. Safe to call after every post create or
 * edit; rows owned by another user or already linked to a different post are
 * ignored.
 */
export async function claimInlineAttachments(
  postId: string,
  body: string,
): Promise<void> {
  if (!body) return;
  const matches = body.matchAll(/[?&]att=([0-9a-f-]{36})/gi);
  const ids = Array.from(new Set(Array.from(matches, (m) => m[1])));
  if (ids.length === 0) return;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Only claim orphans that the current user uploaded. RLS already enforces
  // this for UPDATE, but the explicit predicate keeps the query small.
  await supabase
    .from('attachments')
    .update({ post_id: postId })
    .in('id', ids)
    .is('post_id', null)
    .eq('uploader_id', user.id);
}
