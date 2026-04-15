-- ============================================================
-- Phase 18 — Inbound Email
-- ============================================================

-- Auto-reply rate limiting log
CREATE TABLE auto_reply_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  reply_type TEXT NOT NULL CHECK (reply_type IN (
    'unknown_sender', 'blocked_user', 'duplicate_ticket', 'rate_limit'
  )),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auto_reply_log_recipient_sent
  ON auto_reply_log (recipient_email, sent_at DESC);

-- RLS: only service_role can read/write (system-generated)
ALTER TABLE auto_reply_log ENABLE ROW LEVEL SECURITY;

-- Inbound email configuration settings
INSERT INTO app_settings (key, value) VALUES
  ('inbound_email_enabled', 'false'),
  ('inbound_email_reply_to_address', '')
ON CONFLICT (key) DO NOTHING;

-- Auto-reply notification templates
INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('auto_reply_unknown_sender',
   'Unable to process your email',
   'Your email could not be processed because your address is not registered in our system. Please register at {{registrationUrl}} to create support tickets.')
ON CONFLICT (event_type) DO NOTHING;

INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('auto_reply_blocked_user',
   'Unable to process your email',
   'Your email could not be processed because your account is currently restricted. Please contact support for assistance.')
ON CONFLICT (event_type) DO NOTHING;

INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('auto_reply_duplicate_ticket',
   'Unable to process your reply',
   'Your reply could not be processed because this ticket has been closed as a duplicate. Please continue the conversation at the original ticket: [#{{originalTicketId}}](/tickets/{{originalTicketId}}).')
ON CONFLICT (event_type) DO NOTHING;

INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('auto_reply_rate_limit',
   'Ticket creation limit reached',
   'Your email could not be processed because you have reached the maximum number of tickets that can be created in a 24-hour period. Please try again later or use the web interface.')
ON CONFLICT (event_type) DO NOTHING;

-- pg_cron: daily cleanup of auto_reply_log rows older than 24 hours
-- (Integrates with the existing daily cron pattern from architecture constraint 11)
-- Only schedule if pg_cron extension is available (production environments)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-auto-reply-log',
      '0 3 * * *',
      'DELETE FROM auto_reply_log WHERE sent_at < now() - interval ''24 hours'''
    );
  END IF;
END
$$;
