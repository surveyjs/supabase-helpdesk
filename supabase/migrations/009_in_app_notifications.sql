-- =============================================================================
-- 009_in_app_notifications.sql — In-App Notifications & Realtime
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Notifications table
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 2. RLS policies
-- ---------------------------------------------------------------------------

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (auth.uid() = recipient_id);

-- Insert via service role only (notifications are system-generated)
CREATE POLICY notifications_insert ON notifications
  FOR INSERT TO service_role WITH CHECK (true);

-- Users can update their own notifications (mark read/unread)
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (auth.uid() = recipient_id);

-- Users can delete their own notifications (for cleanup)
CREATE POLICY notifications_delete ON notifications
  FOR DELETE USING (auth.uid() = recipient_id);

-- ---------------------------------------------------------------------------
-- 3. Enable Realtime publication for live updates
-- ---------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE posts;
ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- ---------------------------------------------------------------------------
-- 4. Notification cleanup cron job (only if pg_cron is available)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-notifications',
      '0 3 * * *',
      $cron$
      DELETE FROM notifications
      WHERE (is_read = true AND created_at < now() - interval '30 days')
         OR (created_at < now() - interval '90 days');
      $cron$
    );
  END IF;
END
$$;
