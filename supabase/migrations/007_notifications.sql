-- ============================================================
-- Phase 9 — Email Notifications
-- ============================================================

-- --------------------------------------------------------
-- Email Configuration Table
-- --------------------------------------------------------

CREATE TABLE email_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  smtp_host TEXT NOT NULL DEFAULT '',
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_username TEXT NOT NULL DEFAULT '',
  smtp_password TEXT NOT NULL DEFAULT '',
  sender_email TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT 'HelpDesk',
  is_verified BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_config_select ON email_config
  FOR SELECT USING (is_admin());
CREATE POLICY email_config_update ON email_config
  FOR UPDATE USING (is_admin());
CREATE POLICY email_config_insert ON email_config
  FOR INSERT WITH CHECK (is_admin());

-- Seed a single config row (only one config is used)
INSERT INTO email_config (id) VALUES (gen_random_uuid());

-- --------------------------------------------------------
-- User Notification Preferences Table
-- --------------------------------------------------------

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own preferences
CREATE POLICY notification_preferences_select ON notification_preferences
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY notification_preferences_insert ON notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY notification_preferences_update ON notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);

-- --------------------------------------------------------
-- Notification Coalescing Queue Table
-- --------------------------------------------------------

CREATE TABLE notification_coalescing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  events JSONB NOT NULL DEFAULT '[]',
  triggering_agent_id UUID REFERENCES profiles(id),
  send_after TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_coalescing_queue_ticket_recipient
  ON notification_coalescing_queue (ticket_id, recipient_id);

CREATE INDEX idx_coalescing_queue_send_after
  ON notification_coalescing_queue (send_after);

ALTER TABLE notification_coalescing_queue ENABLE ROW LEVEL SECURITY;

-- Only authenticated users (service role bypasses RLS regardless)
CREATE POLICY coalescing_queue_service ON notification_coalescing_queue
  FOR ALL USING (auth.uid() IS NOT NULL);

-- --------------------------------------------------------
-- Default Notification Preferences & Coalescing Delay
-- --------------------------------------------------------

INSERT INTO app_settings (key, value) VALUES
  ('default_notification_preferences', '{"new_post":{"email":true,"in_app":true},"status_changed":{"email":true,"in_app":true},"agent_assigned":{"email":true,"in_app":true},"agent_assigned_to_agent":{"email":true,"in_app":true},"user_reply_to_agent":{"email":true,"in_app":true},"auto_reopen":{"email":true,"in_app":true}}'),
  ('notification_coalescing_delay_minutes', '2')
ON CONFLICT (key) DO NOTHING;

-- --------------------------------------------------------
-- Additional Notification Templates for new events
-- --------------------------------------------------------

INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('urgency_changed', 'Ticket urgency updated', 'The urgency of your ticket "{{ticketTitle}}" has been changed to {{newUrgency}}.'),
  ('severity_changed', 'Ticket severity updated', 'The severity of your ticket "{{ticketTitle}}" has been changed to {{newSeverity}}.'),
  ('privacy_changed', 'Ticket privacy updated', 'The privacy setting of your ticket "{{ticketTitle}}" has been updated.'),
  ('consolidated_update', 'Updates on your ticket', 'There have been updates to your ticket "{{ticketTitle}}":\n\n{{changeList}}')
ON CONFLICT (event_type) DO NOTHING;
