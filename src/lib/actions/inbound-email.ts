'use server';

import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';
import { renderTemplate } from '@/lib/email/templates';
import { notifyTicketRecipients, notifyAgent } from '@/lib/email/notify';
import { generateSlug } from '@/lib/utils/slug';
import { sanitizeSvg } from '@/lib/utils/svg-sanitize';
import { initializeSlaTimer, stopFirstResponseTimer, resumeSlaTimer } from '@/lib/utils/sla';
import { cancelCsatSurvey } from '@/lib/actions/csat';
import { stripEmailSignature, extractTicketIdFromSubject } from '@/lib/utils/email-parser';

// ============================================================
// Types
// ============================================================

export type InboundEmailPayload = {
  from: string;        // Sender email address
  subject: string;     // Email subject
  text: string;        // Plain text body
  html?: string;       // HTML body (fallback)
  messageId?: string;  // Message-ID header for idempotency
  attachments?: InboundAttachment[];
};

export type InboundAttachment = {
  filename: string;
  content: string;     // Base64-encoded content
  contentType: string;
  size: number;
};

// ============================================================
// MIME type map (from attachments.ts pattern)
// ============================================================

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
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

// ============================================================
// Helper: Auto-Reply Rate Limiting
// ============================================================

async function canSendAutoReply(recipientEmail: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from('auto_reply_log')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_email', recipientEmail.toLowerCase())
    .gte('sent_at', oneHourAgo);

  return (count ?? 0) < 3;
}

async function logAutoReply(
  recipientEmail: string,
  replyType: 'unknown_sender' | 'blocked_user' | 'duplicate_ticket' | 'rate_limit',
): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase.from('auto_reply_log').insert({
    recipient_email: recipientEmail.toLowerCase(),
    reply_type: replyType,
  });
}

// ============================================================
// Helper: Send Auto-Reply Email
// ============================================================

async function sendAutoReply(
  recipientEmail: string,
  templateEventType: string,
  placeholders: Record<string, string>,
  replyType: 'unknown_sender' | 'blocked_user' | 'duplicate_ticket' | 'rate_limit',
): Promise<void> {
  const canSend = await canSendAutoReply(recipientEmail);
  if (!canSend) return;

  try {
    const { subject, html } = await renderTemplate(templateEventType, placeholders);
    const sent = await sendEmail(recipientEmail, subject, html);
    if (!sent) return;

    await logAutoReply(recipientEmail, replyType);
  } catch (err) {
    console.error('[inbound-email] Failed to send auto-reply:', err);
  }
}

// ============================================================
// Helper: Strip HTML tags (fallback when only HTML body available)
// ============================================================

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ============================================================
// Helper: Handle Attachments for Inbound Email
// ============================================================

async function handleInboundAttachments(
  ticketId: number,
  postId: string,
  attachments: InboundAttachment[],
): Promise<string> {
  if (!attachments || attachments.length === 0) return '';

  const supabase = createServiceRoleClient();

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
  const maxSizeMb = Number.isFinite(parsedMaxSize) && parsedMaxSize > 0 ? parsedMaxSize : 10;
  const parsedMaxFiles = maxFilesRes.data ? parseInt(maxFilesRes.data.value, 10) : NaN;
  const maxFilesPerPost = Number.isFinite(parsedMaxFiles) && parsedMaxFiles > 0 ? parsedMaxFiles : 5;
  const maxSizeBytes = maxSizeMb * 1024 * 1024;

  const excluded: { filename: string; reason: string }[] = [];
  let uploadedCount = 0;

  for (const att of attachments) {
    // Check files-per-post limit
    if (uploadedCount >= maxFilesPerPost) {
      excluded.push({ filename: att.filename, reason: `max ${maxFilesPerPost} files per post` });
      continue;
    }

    // Check file type
    const ext = getFileExtension(att.filename);
    if (!allowedTypes.includes(ext)) {
      excluded.push({ filename: att.filename, reason: `file type .${ext} not allowed` });
      continue;
    }

    // MIME type validation
    const expectedMimes = EXTENSION_MIME_MAP[ext];
    if (expectedMimes && !expectedMimes.includes(att.contentType) && att.contentType !== 'application/octet-stream') {
      excluded.push({ filename: att.filename, reason: 'mismatched file type' });
      continue;
    }

    try {
      // Decode base64 content and validate actual size
      const decoded = Buffer.from(att.content, 'base64');

      if (decoded.length > maxSizeBytes) {
        excluded.push({ filename: att.filename, reason: `exceeds ${maxSizeMb}MB limit` });
        continue;
      }
      let fileBuffer: Uint8Array = new Uint8Array(decoded);

      // SVG sanitization
      if (ext === 'svg') {
        fileBuffer = sanitizeSvg(fileBuffer) as Uint8Array;
      }

      const uuid = crypto.randomUUID();
      const safeName = sanitizeFilename(att.filename);
      const storagePath = `tickets/${ticketId}/posts/${postId}/${uuid}-${safeName}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('attachments')
        .upload(storagePath, fileBuffer, {
          contentType: att.contentType,
          upsert: false,
        });

      if (uploadError) {
        excluded.push({ filename: att.filename, reason: 'upload failed' });
        continue;
      }

      // Insert attachment record
      const { error: insertError } = await supabase
        .from('attachments')
        .insert({
          post_id: postId,
          storage_path: storagePath,
          original_filename: att.filename,
          file_size: att.size,
          mime_type: att.contentType,
        });

      if (insertError) {
        await supabase.storage.from('attachments').remove([storagePath]);
        excluded.push({ filename: att.filename, reason: 'record creation failed' });
        continue;
      }

      uploadedCount++;
    } catch (err) {
      console.error(`[inbound-email] Failed to process attachment ${att.filename}:`, err);
      excluded.push({ filename: att.filename, reason: 'processing error' });
    }
  }

  // Return footnote for excluded attachments
  if (excluded.length > 0) {
    const items = excluded.map((e) => `${e.filename} (${e.reason})`).join(', ');
    return `\n\n---\n*The following attachments were not included: ${items}*`;
  }

  return '';
}

// ============================================================
// Main Processing Action
// ============================================================

export async function processInboundEmail(
  payload: InboundEmailPayload,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createServiceRoleClient();

    const senderEmail = payload.from.toLowerCase().trim();
    const subject = payload.subject?.trim() ?? '(no subject)';
    let body = payload.text ?? '';

    // If only HTML is available, strip tags
    if (!body && payload.html) {
      body = stripHtmlTags(payload.html);
    }

    // -----------------------------------------------------------
    // Check inbound email enabled
    // -----------------------------------------------------------
    const { data: enabledSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'inbound_email_enabled')
      .single();

    if (!enabledSetting || enabledSetting.value !== 'true') {
      return { success: true }; // Discard silently
    }

    // -----------------------------------------------------------
    // Idempotency check via Message-ID
    // -----------------------------------------------------------
    if (payload.messageId) {
      const { count } = await supabase
        .from('auto_reply_log')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_email', `msgid:${payload.messageId}`);

      if (count && count > 0) {
        return { success: true }; // Already processed
      }

      // Log the message ID to prevent reprocessing
      await supabase.from('auto_reply_log').insert({
        recipient_email: `msgid:${payload.messageId}`,
        reply_type: 'unknown_sender', // Reuse the type; this is just for idempotency
      });
    }

    // -----------------------------------------------------------
    // Step 1: Identify sender
    // -----------------------------------------------------------
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('id, role, is_blocked, display_name, email')
      .ilike('email', senderEmail)
      .single();

    if (!senderProfile) {
      // Unknown sender
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
      await sendAutoReply(
        senderEmail,
        'auto_reply_unknown_sender',
        { registrationUrl: `${appUrl}/auth/signup` },
        'unknown_sender',
      );
      return { success: true };
    }

    // -----------------------------------------------------------
    // Step 2: Check blocked status
    // -----------------------------------------------------------
    if (senderProfile.is_blocked) {
      await sendAutoReply(
        senderEmail,
        'auto_reply_blocked_user',
        {},
        'blocked_user',
      );
      return { success: true };
    }

    // -----------------------------------------------------------
    // Step 3: Strip email signature
    // -----------------------------------------------------------
    const strippedBody = stripEmailSignature(body);

    // If result is empty AND original was also empty → discard
    if (!strippedBody.trim() && !body.trim()) {
      return { success: true };
    }

    const isAgent = senderProfile.role === 'agent' || senderProfile.role === 'admin';

    // -----------------------------------------------------------
    // Step 4: Determine if reply or new ticket
    // -----------------------------------------------------------
    const ticketId = extractTicketIdFromSubject(subject);

    if (ticketId !== null) {
      // -----------------------------------------------------------
      // Step 5: Process as reply
      // -----------------------------------------------------------
      return await processAsReply(
        supabase,
        ticketId,
        senderProfile,
        isAgent,
        strippedBody,
        payload.attachments ?? [],
      );
    } else {
      // -----------------------------------------------------------
      // Step 6: Process as new ticket
      // -----------------------------------------------------------
      return await processAsNewTicket(
        supabase,
        senderProfile,
        isAgent,
        subject,
        strippedBody,
        payload.attachments ?? [],
      );
    }
  } catch (err) {
    console.error('[inbound-email] Processing error:', err);
    return { success: false, error: 'Internal processing error' };
  }
}

// ============================================================
// Step 5: Process as Reply
// ============================================================

async function processAsReply(
  supabase: ReturnType<typeof createServiceRoleClient>,
  ticketId: number,
  sender: { id: string; role: string; is_blocked: boolean; display_name: string | null; email: string | null },
  isAgent: boolean,
  body: string,
  attachments: InboundAttachment[],
): Promise<{ success: boolean; error?: string }> {
  // Fetch the ticket
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, slug, status, creator_id, duplicate_of_id, assigned_agent_id, title')
    .eq('id', ticketId)
    .single();

  if (!ticket) {
    return { success: true }; // Discard silently
  }

  // Check if sender has permission (creator, assigned agent, follower, or teammate)
  const isCreator = ticket.creator_id === sender.id;

  if (!isCreator && !isAgent) {
    // Check if user is a follower
    const { count: followerCount } = await supabase
      .from('ticket_followers')
      .select('user_id', { count: 'exact', head: true })
      .eq('ticket_id', ticketId)
      .eq('user_id', sender.id);

    if (!followerCount || followerCount === 0) {
      // Check if sender is a teammate of the ticket creator (mirrors is_teammate RLS)
      const { data: senderProfile } = await supabase
        .from('profiles')
        .select('team_id')
        .eq('id', sender.id)
        .single();

      const { data: creatorProfile } = await supabase
        .from('profiles')
        .select('team_id')
        .eq('id', ticket.creator_id)
        .single();

      const isTeammate =
        senderProfile?.team_id != null &&
        creatorProfile?.team_id != null &&
        senderProfile.team_id === creatorProfile.team_id;

      if (!isTeammate) {
        // Check if ticket is public and user can access
        const { data: ticketAccess } = await supabase
          .from('tickets')
          .select('is_private')
          .eq('id', ticketId)
          .single();

        if (ticketAccess?.is_private) {
          return { success: true }; // No access, discard silently
        }
      }
    }
  }

  // Check duplicate restriction for non-agents
  if (!isAgent && ticket.duplicate_of_id) {
    await sendAutoReply(
      sender.email ?? '',
      'auto_reply_duplicate_ticket',
      { originalTicketId: String(ticket.duplicate_of_id) },
      'duplicate_ticket',
    );
    return { success: true };
  }

  // Create a new post
  const { data: post, error: postError } = await supabase
    .from('posts')
    .insert({
      ticket_id: ticket.id,
      author_id: sender.id,
      body,
      post_type: 'post',
    })
    .select('id')
    .single();

  if (postError || !post) {
    console.error('[inbound-email] Failed to create reply post:', postError);
    return { success: false, error: 'Failed to create reply' };
  }

  // Handle attachments
  const attachmentFootnote = await handleInboundAttachments(ticket.id, post.id, attachments);
  if (attachmentFootnote) {
    await supabase
      .from('posts')
      .update({ body: body + attachmentFootnote })
      .eq('id', post.id);
  }

  // Auto-transition status for non-agents
  let autoReopened = false;
  if (!isAgent && (ticket.status === 'closed' || ticket.status === 'pending')) {
    const { error: statusError } = await supabase
      .from('tickets')
      .update({ status: 'open' })
      .eq('id', ticket.id);

    if (!statusError) {
      autoReopened = true;
      if (ticket.status === 'closed') {
        cancelCsatSurvey(ticket.id).catch((err) => console.error('[csat]', err));
      }
      resumeSlaTimer(ticket.id).catch((err) => console.error('[sla]', err));

      await supabase.from('activity_log').insert({
        ticket_id: ticket.id,
        actor_id: sender.id,
        action: 'status_changed',
        details: {
          from: ticket.status,
          to: 'open',
          reason: 'User email reply auto-transition',
        },
      });
    }
  }

  // Notifications
  const placeholders = { authorName: sender.display_name ?? sender.email ?? '' };

  if (isAgent) {
    notifyTicketRecipients(ticket.id, 'new_post', placeholders, sender.id, sender.id)
      .catch((err) => console.error('[notify]', err));

    // Check if this is the first agent reply — stop first response timer
    const { count: agentReplyCount } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_id', ticket.id)
      .eq('post_type', 'post')
      .eq('is_original', false)
      .neq('author_id', ticket.creator_id);

    if (agentReplyCount !== null && agentReplyCount <= 1) {
      stopFirstResponseTimer(ticket.id).catch((err) => console.error('[sla]', err));
    }
  } else {
    notifyTicketRecipients(ticket.id, 'new_post', placeholders, sender.id)
      .catch((err) => console.error('[notify]', err));

    if (ticket.assigned_agent_id && ticket.assigned_agent_id !== sender.id) {
      notifyAgent(ticket.assigned_agent_id, 'user_reply_to_agent', ticket.id, placeholders)
        .catch((err) => console.error('[notify]', err));
    }

    if (autoReopened) {
      notifyTicketRecipients(ticket.id, 'auto_reopen', placeholders, sender.id)
        .catch((err) => console.error('[notify]', err));
    }
  }

  return { success: true };
}

// ============================================================
// Step 6: Process as New Ticket
// ============================================================

async function processAsNewTicket(
  supabase: ReturnType<typeof createServiceRoleClient>,
  sender: { id: string; role: string; is_blocked: boolean; display_name: string | null; email: string | null },
  isAgent: boolean,
  subject: string,
  body: string,
  attachments: InboundAttachment[],
): Promise<{ success: boolean; error?: string }> {
  // Rate limit check (agents exempt)
  if (!isAgent) {
    const { data: rateLimitSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'ticket_creation_rate_limit')
      .single();

    const rateLimit = rateLimitSetting ? parseInt(rateLimitSetting.value, 10) : 10;

    if (rateLimit > 0) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('creator_id', sender.id)
        .gte('created_at', since);

      if (count !== null && count >= rateLimit) {
        await sendAutoReply(
          sender.email ?? '',
          'auto_reply_rate_limit',
          {},
          'rate_limit',
        );
        return { success: true };
      }
    }
  }

  // Get default privacy setting
  const { data: defaultPrivacySetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'ticket_default_privacy')
    .single();

  const isPrivate = defaultPrivacySetting?.value !== 'false';

  // Get default ticket type
  const { data: defaultType } = await supabase
    .from('ticket_types')
    .select('id')
    .limit(1)
    .single();

  if (!defaultType) {
    console.error('[inbound-email] No ticket types configured');
    return { success: false, error: 'No ticket types configured' };
  }

  // Build custom field defaults
  const { data: customFieldDefs } = await supabase
    .from('custom_fields')
    .select('*')
    .order('display_order');

  const customFieldValues: Record<string, unknown> = {};
  if (customFieldDefs) {
    for (const def of customFieldDefs) {
      if (def.default_value !== null && def.default_value !== undefined) {
        if (def.field_type === 'checkbox') {
          customFieldValues[def.name] = def.default_value === 'true';
        } else if (def.field_type === 'number') {
          const num = parseFloat(def.default_value);
          if (!isNaN(num)) customFieldValues[def.name] = num;
        } else {
          customFieldValues[def.name] = def.default_value;
        }
      }
    }
  }

  // Create ticket title from subject
  const title = subject.slice(0, 300).trim() || '(no subject)';
  const slug = generateSlug(title);

  // Insert ticket
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .insert({
      title,
      slug,
      creator_id: sender.id,
      status: 'open',
      urgency: 'medium',
      severity: 'medium',
      is_private: isPrivate,
      type_id: defaultType.id,
      category_id: null,
      custom_fields: Object.keys(customFieldValues).length > 0 ? customFieldValues : {},
    })
    .select('id, slug')
    .single();

  if (ticketError || !ticket) {
    console.error('[inbound-email] Failed to create ticket:', ticketError);
    return { success: false, error: 'Failed to create ticket' };
  }

  // Insert original post
  const { data: post, error: postError } = await supabase
    .from('posts')
    .insert({
      ticket_id: ticket.id,
      author_id: sender.id,
      body,
      is_original: true,
      post_type: 'post',
    })
    .select('id')
    .single();

  if (postError || !post) {
    // Cleanup: delete the ticket if post creation fails
    await supabase.from('tickets').delete().eq('id', ticket.id);
    console.error('[inbound-email] Failed to create original post:', postError);
    return { success: false, error: 'Failed to create ticket' };
  }

  // Handle attachments
  const attachmentFootnote = await handleInboundAttachments(ticket.id, post.id, attachments);
  if (attachmentFootnote) {
    await supabase
      .from('posts')
      .update({ body: body + attachmentFootnote })
      .eq('id', post.id);
  }

  // Auto-follow creator
  await supabase
    .from('ticket_followers')
    .insert({ ticket_id: ticket.id, user_id: sender.id });

  // Initialize SLA timer
  initializeSlaTimer(ticket.id, 'medium').catch((err) => console.error('[sla]', err));

  // Standard new-ticket notifications (do NOT apply AI auto-categorization)
  notifyTicketRecipients(ticket.id, 'new_post', {
    authorName: sender.display_name ?? sender.email ?? '',
  }, sender.id).catch((err) => console.error('[notify]', err));

  return { success: true };
}
