import nodemailer from 'nodemailer';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Fetch inbound email settings for Reply-To header support.
 * Uses a short-lived in-memory cache to avoid repeated app_settings queries
 * on high-volume email send paths (e.g. notification cron batches).
 */
const INBOUND_SETTINGS_TTL_MS = 60_000;
let _inboundSettingsCache: { value: { enabled: boolean; replyToAddress: string }; expiresAt: number } | null = null;

async function getInboundEmailSettings(): Promise<{ enabled: boolean; replyToAddress: string }> {
  if (_inboundSettingsCache && _inboundSettingsCache.expiresAt > Date.now()) {
    return _inboundSettingsCache.value;
  }

  const supabase = createServiceRoleClient();
  const [enabledRes, addressRes] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'inbound_email_enabled').single(),
    supabase.from('app_settings').select('value').eq('key', 'inbound_email_reply_to_address').single(),
  ]);
  const value = {
    enabled: enabledRes.data?.value === 'true',
    replyToAddress: addressRes.data?.value ?? '',
  };
  _inboundSettingsCache = { value, expiresAt: Date.now() + INBOUND_SETTINGS_TTL_MS };
  return value;
}

/**
 * Send an email using the SMTP configuration stored in the email_config table.
 * If SMTP is not configured or not verified, logs a warning and returns false.
 *
 * When inbound email is enabled and a reply-to address is configured,
 * sets the Reply-To header so recipients can reply directly.
 * If a ticketId is provided, includes [Ticket #ID] in the subject for thread matching.
 */
export async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string,
  options?: { ticketId?: number },
): Promise<boolean> {
  try {
    const supabase = createServiceRoleClient();

    const { data: config, error } = await supabase
      .from('email_config')
      .select('*')
      .limit(1)
      .single();

    if (error || !config) {
      console.warn('[email] No email config found, skipping email send.');
      return false;
    }

    if (!config.smtp_host || !config.sender_email) {
      console.warn('[email] SMTP not configured, skipping email send.');
      return false;
    }

    if (!config.is_verified) {
      console.warn('[email] SMTP not verified, skipping email send.');
      return false;
    }

    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port,
      secure: config.smtp_port === 465,
      auth:
        config.smtp_username
          ? { user: config.smtp_username, pass: config.smtp_password }
          : undefined,
    });

    // Strip CR/LF to prevent email header injection
    const safeSubject = subject.replace(/[\r\n]/g, ' ');

    // Build mail options
    const mailOptions: nodemailer.SendMailOptions = {
      from: `"${config.sender_name}" <${config.sender_email}>`,
      to,
      subject: safeSubject,
      html: htmlBody,
    };

    // Add Reply-To header and [Ticket #ID] prefix when inbound email is enabled
    try {
      const inbound = await getInboundEmailSettings();
      if (inbound.enabled && inbound.replyToAddress) {
        mailOptions.replyTo = inbound.replyToAddress;
        if (options?.ticketId && !safeSubject.includes(`[Ticket #${options.ticketId}]`)) {
          mailOptions.subject = `[Ticket #${options.ticketId}] ${safeSubject}`;
        }
      }
    } catch {
      // Non-critical: continue sending without Reply-To
    }

    await transporter.sendMail(mailOptions);

    return true;
  } catch (err) {
    console.error('[email] Failed to send email:', err);
    return false;
  }
}

/**
 * Send a test email to verify SMTP settings.
 * Uses provided config (not from DB) so admin can test before saving.
 */
export async function sendTestEmailRaw(config: {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  sender_email: string;
  sender_name: string;
}, to: string): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port,
      secure: config.smtp_port === 465,
      auth:
        config.smtp_username
          ? { user: config.smtp_username, pass: config.smtp_password }
          : undefined,
    });

    await transporter.sendMail({
      from: `"${config.sender_name}" <${config.sender_email}>`,
      to,
      subject: 'HelpDesk Test Email',
      html: '<p>This is a test email from HelpDesk. If you received this, your SMTP configuration is working correctly.</p>',
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[email] Test email failed:', message);
    return { success: false, error: message };
  }
}
