-- ============================================================
-- Phase 12 — SLA Policies
-- ============================================================

-- SLA Policies Table
CREATE TABLE sla_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) <= 100),
  first_response_minutes INTEGER NOT NULL CHECK (first_response_minutes > 0),
  resolution_minutes INTEGER NOT NULL CHECK (resolution_minutes > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY sla_policies_select ON sla_policies
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sla_policies_insert ON sla_policies
  FOR INSERT WITH CHECK (is_admin());
CREATE POLICY sla_policies_update ON sla_policies
  FOR UPDATE USING (is_admin());
CREATE POLICY sla_policies_delete ON sla_policies
  FOR DELETE USING (is_admin());

-- SLA Severity Mapping Table
CREATE TABLE sla_severity_mapping (
  severity priority_level PRIMARY KEY,
  sla_policy_id UUID REFERENCES sla_policies(id) ON DELETE SET NULL
);

INSERT INTO sla_severity_mapping (severity) VALUES
  ('low'), ('medium'), ('high'), ('critical');

ALTER TABLE sla_severity_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY sla_severity_mapping_select ON sla_severity_mapping
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sla_severity_mapping_update ON sla_severity_mapping
  FOR UPDATE USING (is_admin());

-- SLA Timers Table
CREATE TABLE sla_timers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE UNIQUE,
  sla_policy_id UUID REFERENCES sla_policies(id) ON DELETE SET NULL,
  first_response_deadline TIMESTAMPTZ,
  resolution_deadline TIMESTAMPTZ,
  first_response_elapsed_minutes INTEGER NOT NULL DEFAULT 0,
  resolution_elapsed_minutes INTEGER NOT NULL DEFAULT 0,
  first_response_paused_at TIMESTAMPTZ,
  resolution_paused_at TIMESTAMPTZ,
  first_response_last_resumed_at TIMESTAMPTZ,
  resolution_last_resumed_at TIMESTAMPTZ,
  first_response_met BOOLEAN,
  resolution_met BOOLEAN,
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  is_paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sla_timers_ticket_id ON sla_timers (ticket_id);
CREATE INDEX idx_sla_timers_first_response_deadline
  ON sla_timers (first_response_deadline)
  WHERE first_response_met IS NULL;
CREATE INDEX idx_sla_timers_resolution_deadline
  ON sla_timers (resolution_deadline)
  WHERE resolution_met IS NULL;

ALTER TABLE sla_timers ENABLE ROW LEVEL SECURITY;

CREATE POLICY sla_timers_select ON sla_timers
  FOR SELECT USING (is_agent());
CREATE POLICY sla_timers_insert ON sla_timers
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY sla_timers_update ON sla_timers
  FOR UPDATE USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY sla_timers_delete ON sla_timers
  FOR DELETE USING (auth.role() = 'service_role');

-- SLA Notifications Sent (dedup tracking)
CREATE TABLE sla_notifications_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sla_timer_id UUID NOT NULL REFERENCES sla_timers(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('approaching_first_response', 'approaching_resolution', 'breached_first_response', 'breached_resolution')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sla_timer_id, notification_type)
);

ALTER TABLE sla_notifications_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY sla_notifications_sent_select ON sla_notifications_sent
  FOR SELECT USING (is_agent());
CREATE POLICY sla_notifications_sent_insert ON sla_notifications_sent
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Business Hours Settings
INSERT INTO app_settings (key, value) VALUES
  ('sla_business_hours', '{"timezone":"UTC","schedule":{"monday":{"start":"09:00","end":"17:00"},"tuesday":{"start":"09:00","end":"17:00"},"wednesday":{"start":"09:00","end":"17:00"},"thursday":{"start":"09:00","end":"17:00"},"friday":{"start":"09:00","end":"17:00"},"saturday":null,"sunday":null}}'),
  ('sla_approaching_threshold', '75')
ON CONFLICT (key) DO NOTHING;

-- SLA Notification Templates
INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('sla_approaching_first_response', 'SLA Warning: First response approaching on ticket #{{ticketId}}', 'The first response SLA target for ticket "{{ticketTitle}}" is approaching. {{elapsedTime}} of {{targetTime}} business hours elapsed ({{percentage}}%).'),
  ('sla_approaching_resolution', 'SLA Warning: Resolution approaching on ticket #{{ticketId}}', 'The resolution SLA target for ticket "{{ticketTitle}}" is approaching. {{elapsedTime}} of {{targetTime}} business hours elapsed ({{percentage}}%).'),
  ('sla_breached_first_response', 'SLA Breached: First response overdue on ticket #{{ticketId}}', 'The first response SLA target for ticket "{{ticketTitle}}" has been breached. Target was {{targetTime}} business hours; {{elapsedTime}} has elapsed.'),
  ('sla_breached_resolution', 'SLA Breached: Resolution overdue on ticket #{{ticketId}}', 'The resolution SLA target for ticket "{{ticketTitle}}" has been breached. Target was {{targetTime}} business hours; {{elapsedTime}} has elapsed.')
ON CONFLICT (event_type) DO NOTHING;

-- SLA Monitoring Cron Job (only if pg_cron is available)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'check-sla-timers',
      '*/5 * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.settings.base_url', true) || '/api/cron/sla',
        headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.cron_secret', true)),
        body := '{}'
      );
      $cron$
    );
  END IF;
END
$$;
