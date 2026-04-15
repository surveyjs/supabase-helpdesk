import { NextResponse } from 'next/server';
import { processInboundEmail } from '@/lib/actions/inbound-email';
import type { InboundEmailPayload } from '@/lib/actions/inbound-email';

/**
 * POST handler for receiving inbound emails from the email provider (webhook).
 *
 * Supports a generic payload format. Provider-specific adapters can be added
 * by extending the parsePayload function.
 *
 * Always returns 200 OK to prevent email provider retries on expected rejections.
 */
export async function POST(request: Request) {
  try {
    // -----------------------------------------------------------
    // Authenticate webhook request
    // -----------------------------------------------------------
    const authHeader = request.headers.get('Authorization');
    const webhookSecret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? process.env.CRON_SECRET;

    if (webhookSecret && authHeader !== `Bearer ${webhookSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // -----------------------------------------------------------
    // Parse the inbound email payload
    // -----------------------------------------------------------
    const contentType = request.headers.get('Content-Type') ?? '';
    let payload: InboundEmailPayload;

    if (contentType.includes('application/json')) {
      payload = await parseJsonPayload(request);
    } else if (contentType.includes('multipart/form-data')) {
      payload = await parseMultipartPayload(request);
    } else {
      // Default: try JSON
      payload = await parseJsonPayload(request);
    }

    if (!payload.from) {
      return NextResponse.json({ received: true, error: 'Missing sender' }, { status: 200 });
    }

    // -----------------------------------------------------------
    // Process the email
    // -----------------------------------------------------------
    await processInboundEmail(payload);

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error('[inbound-email-webhook] Error processing request:', err);
    // Return 200 even on errors to prevent retries
    return NextResponse.json({ received: true }, { status: 200 });
  }
}

// ============================================================
// Payload Parsers (Provider-specific adapters)
// ============================================================

/**
 * Parse a JSON payload (generic format or SendGrid-like).
 */
async function parseJsonPayload(request: Request): Promise<InboundEmailPayload> {
  const json = await request.json();

  // Support both flat format and nested envelope formats
  const from = extractEmail(json.from ?? json.sender ?? json.envelope?.from ?? '');
  const subject = json.subject ?? '';
  const text = json.text ?? json.plain ?? json.body ?? '';
  const html = json.html ?? '';
  const messageId = json.messageId ?? json.message_id ?? json['Message-ID'] ?? '';

  // Parse attachments
  const attachments = parseAttachments(json.attachments ?? []);

  return { from, subject, text, html, messageId, attachments };
}

/**
 * Parse a multipart/form-data payload (SendGrid Inbound Parse format).
 */
async function parseMultipartPayload(request: Request): Promise<InboundEmailPayload> {
  const formData = await request.formData();

  const from = extractEmail((formData.get('from') as string) ?? '');
  const subject = (formData.get('subject') as string) ?? '';
  const text = (formData.get('text') as string) ?? '';
  const html = (formData.get('html') as string) ?? '';
  const messageId = (formData.get('message_id') as string) ?? '';

  // Parse attachment info
  const attachmentInfoRaw = formData.get('attachment-info') as string;
  const attachments: InboundEmailPayload['attachments'] = [];

  if (attachmentInfoRaw) {
    try {
      const attachmentInfo = JSON.parse(attachmentInfoRaw);
      for (const key of Object.keys(attachmentInfo)) {
        const file = formData.get(key) as File | null;
        if (file) {
          const buffer = await file.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          attachments.push({
            filename: attachmentInfo[key].filename ?? file.name,
            content: base64,
            contentType: attachmentInfo[key].type ?? file.type,
            size: file.size,
          });
        }
      }
    } catch {
      // Ignore attachment parsing errors
    }
  }

  return { from, subject, text, html, messageId, attachments };
}

/**
 * Extract plain email address from a From header value.
 * e.g., "John Doe <john@example.com>" → "john@example.com"
 */
function extractEmail(from: string): string {
  if (!from) return '';
  const match = from.match(/<([^>]+)>/);
  return match ? match[1].trim().toLowerCase() : from.trim().toLowerCase();
}

/**
 * Parse attachment array from various provider formats.
 */
function parseAttachments(
  raw: Array<Record<string, unknown>>,
): InboundEmailPayload['attachments'] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((att) => att && typeof att === 'object')
    .map((att) => ({
      filename: String(att.filename ?? att.name ?? 'attachment'),
      content: String(att.content ?? att.data ?? ''),
      contentType: String(att.contentType ?? att.content_type ?? att.type ?? 'application/octet-stream'),
      size: Number(att.size ?? 0),
    }));
}
