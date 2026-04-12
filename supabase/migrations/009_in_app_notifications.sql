-- ============================================================
-- Phase 10 — In-App Notifications & Real-Time
-- ============================================================

-- --------------------------------------------------------
-- Notifications Table
-- --------------------------------------------------------

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient_unread
  ON notifications (recipient_id, is_read, created_at DESC)
  WHERE is_read = false;

CREATE INDEX idx_notifications_recipient_created
  ON notifications (recipient_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (auth.uid() = recipient_id);

-- Insert via service role (notifications are system-generated)
-- Or via authenticated user for the system to insert on their behalf
CREATE POLICY notifications_insert ON notifications
  FOR INSERT WITH CHECK (true);  -- Server Actions use service role for inserts

-- Users can update their own notifications (mark read/unread)
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (auth.uid() = recipient_id);

-- Users can delete their own notifications (for cleanup)
CREATE POLICY notifications_delete ON notifications
  FOR DELETE USING (auth.uid() = recipient_id);

-- --------------------------------------------------------
-- Enable Realtime on Relevant Tables
-- --------------------------------------------------------

-- Enable Realtime publication for live updates
-- Posts: for live post appearance on ticket detail
ALTER PUBLICATION supabase_realtime ADD TABLE posts;

-- Tickets: for live status/metadata changes on ticket detail and dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE tickets;

-- Notifications: for live bell icon updates
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- --------------------------------------------------------
-- Notification Cleanup Cron Job
-- --------------------------------------------------------

-- Daily cleanup: read notifications >30 days, all >90 days
SELECT cron.schedule(
  'cleanup-notifications',
  '0 3 * * *',  -- 3 AM daily
  $$
  DELETE FROM notifications
  WHERE (is_read = true AND created_at < now() - interval '30 days')
     OR (created_at < now() - interval '90 days');
  $$
);
