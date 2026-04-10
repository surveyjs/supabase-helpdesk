-- ============================================================
-- Phase 7 — Admin Setup Tables
-- ============================================================

-- --------------------------------------------------------
-- Admin Audit Log Table
-- --------------------------------------------------------

CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_log_created_at ON admin_audit_log (created_at DESC);
CREATE INDEX idx_admin_audit_log_action ON admin_audit_log (action);
CREATE INDEX idx_admin_audit_log_admin_id ON admin_audit_log (admin_id);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_audit_log_select ON admin_audit_log
  FOR SELECT USING (is_admin());

CREATE POLICY admin_audit_log_insert ON admin_audit_log
  FOR INSERT WITH CHECK (is_admin());

-- --------------------------------------------------------
-- Custom Fields Table
-- --------------------------------------------------------

CREATE TABLE custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'dropdown', 'checkbox', 'date')),
  is_required BOOLEAN NOT NULL DEFAULT false,
  default_value TEXT,
  options JSONB,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_fields_select ON custom_fields
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY custom_fields_insert ON custom_fields
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY custom_fields_update ON custom_fields
  FOR UPDATE USING (is_admin());

CREATE POLICY custom_fields_delete ON custom_fields
  FOR DELETE USING (is_admin());

-- --------------------------------------------------------
-- Notification Templates Table
-- --------------------------------------------------------

CREATE TABLE notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  is_customized BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_templates_select ON notification_templates
  FOR SELECT USING (is_admin());

CREATE POLICY notification_templates_update ON notification_templates
  FOR UPDATE USING (is_admin());

-- Seed default notification templates
INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('new_post', 'New reply on your ticket', 'There is a new reply on your ticket "{{ticketTitle}}".'),
  ('status_changed', 'Ticket status updated', 'The status of your ticket "{{ticketTitle}}" has been changed to {{newStatus}}.'),
  ('agent_assigned', 'Agent assigned to your ticket', 'An agent has been assigned to your ticket "{{ticketTitle}}".'),
  ('agent_assigned_to_agent', 'You''ve been assigned a ticket', 'You have been assigned to ticket "{{ticketTitle}}".'),
  ('user_reply_to_agent', 'New reply on your assigned ticket', 'There is a new reply on your assigned ticket "{{ticketTitle}}" from {{authorName}}.'),
  ('auto_reopen', 'Ticket re-opened by user reply', 'Ticket "{{ticketTitle}}" has been re-opened by a new reply from {{authorName}}.'),
  ('duplicate_post', 'Ticket marked as duplicate', 'This ticket has been closed as a duplicate of [#{{ticketId}}](/tickets/{{ticketId}}).'),
  ('merge_post', 'Ticket merged', 'This ticket has been merged into [#{{ticketId}}](/tickets/{{ticketId}}).'),
  ('merge_banner', 'Merge stub banner', 'This ticket has been merged into [#{{ticketId}}](/tickets/{{ticketId}}). All posts have been moved.');

-- --------------------------------------------------------
-- Additional App Settings
-- --------------------------------------------------------

INSERT INTO app_settings (key, value) VALUES
  ('visible_posts_threshold', '10'),
  ('visible_comments_threshold', '3'),
  ('user_page_size', '20'),
  ('other_lists_page_size', '20'),
  ('enforce_display_name_uniqueness', 'false')
ON CONFLICT (key) DO NOTHING;
