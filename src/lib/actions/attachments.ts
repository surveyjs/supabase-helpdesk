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

  const allowedTypes: string[] = allowedTypesRes.data
    ? JSON.parse(allowedTypesRes.data.value)
    : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'txt'];
  const maxSizeMb = maxSizeRes.data ? parseInt(maxSizeRes.data.value, 10) : 10;
  const maxFilesPerPost = maxFilesRes.data ? parseInt(maxFilesRes.data.value, 10) : 5;
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
      fileBuffer = sanitizeSvg(fileBuffer);
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
        storage_path: storagePath,
        original_filename: file.name.slice(0, 255),
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

  // Delete from storage
  await supabase.storage.from('attachments').remove([attachment.storage_path]);

  // Delete record
  await supabase.from('attachments').delete().eq('id', attachmentId);

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
