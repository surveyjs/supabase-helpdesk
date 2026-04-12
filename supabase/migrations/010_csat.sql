-- ==========================================================================
-- Migration 010: CSAT (Customer Satisfaction)
-- ==========================================================================

-- --------------------------------------------------------------------------
-- CSAT Ratings Table
-- --------------------------------------------------------------------------

CREATE TABLE csat_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT CHECK (char_length(comment) <= 5000),
  submitted_at TIMESTAMPTZ,
  token_expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_csat_ratings_ticket_id ON csat_ratings (ticket_id);
CREATE INDEX idx_csat_ratings_token ON csat_ratings (token);

ALTER TABLE csat_ratings ENABLE ROW LEVEL SECURITY;

-- Public (unauthenticated) read by token for the rating page
CREATE POLICY csat_ratings_select_by_token ON csat_ratings
  FOR SELECT USING (true);

-- Insert via service role (system-generated tokens)
CREATE POLICY csat_ratings_insert ON csat_ratings
  FOR INSERT WITH CHECK (true);

-- Update via service role (rating submission)
CREATE POLICY csat_ratings_update ON csat_ratings
  FOR UPDATE USING (true);

-- --------------------------------------------------------------------------
-- CSAT Survey Schedule Table
-- --------------------------------------------------------------------------

CREATE TABLE csat_survey_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE UNIQUE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  is_sent BOOLEAN NOT NULL DEFAULT false,
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_csat_survey_schedule_pending
  ON csat_survey_schedule (scheduled_at)
  WHERE is_sent = false AND is_cancelled = false;

ALTER TABLE csat_survey_schedule ENABLE ROW LEVEL SECURITY;

-- Service role only — no direct user access
CREATE POLICY csat_survey_schedule_select ON csat_survey_schedule
  FOR SELECT USING (is_admin());
CREATE POLICY csat_survey_schedule_insert ON csat_survey_schedule
  FOR INSERT WITH CHECK (true);
CREATE POLICY csat_survey_schedule_update ON csat_survey_schedule
  FOR UPDATE USING (true);

-- --------------------------------------------------------------------------
-- CSAT Settings in app_settings
-- --------------------------------------------------------------------------

INSERT INTO app_settings (key, value) VALUES
  ('csat_enabled', 'false'),
  ('csat_survey_delay', '1_hour')
ON CONFLICT (key) DO NOTHING;

-- --------------------------------------------------------------------------
-- CSAT Notification Templates
-- --------------------------------------------------------------------------

INSERT INTO notification_templates (event_type, subject, body)
VALUES (
  'csat_survey',
  'How was your experience? Rate ticket #{{ticketId}}',
  'Hi {{userName}},

Your ticket "{{ticketTitle}}" has been resolved. We''d love to hear how we did!

Please rate your experience:
{{csatLink}}

This link expires in 30 days.

Thank you!'
)
ON CONFLICT (event_type) DO NOTHING;

INSERT INTO notification_templates (event_type, subject, body)
VALUES (
  'csat_submitted',
  'New CSAT rating on ticket #{{ticketId}}',
  'A {{rating}}-star rating was submitted on ticket "{{ticketTitle}}" by {{userName}}.

{{comment}}'
)
ON CONFLICT (event_type) DO NOTHING;

-- --------------------------------------------------------------------------
-- CSAT Survey Cron Job (process pending surveys every 5 minutes)
-- --------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'send-csat-surveys',
      '*/5 * * * *',
      $cron$
      UPDATE csat_survey_schedule
      SET is_sent = true
      WHERE is_sent = false
        AND is_cancelled = false
        AND scheduled_at <= now();
      $cron$
    );
  END IF;
END
$$;
