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

-- Service role only — no direct public/user access to CSAT tokens or feedback
CREATE POLICY csat_ratings_select_by_token ON csat_ratings
  FOR SELECT TO service_role USING (true);

-- Insert via service role (system-generated tokens)
CREATE POLICY csat_ratings_insert ON csat_ratings
  FOR INSERT TO service_role WITH CHECK (true);

-- Update via service role (rating submission)
CREATE POLICY csat_ratings_update ON csat_ratings
  FOR UPDATE TO service_role USING (true);

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
  FOR SELECT TO service_role USING (true);
CREATE POLICY csat_survey_schedule_insert ON csat_survey_schedule
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY csat_survey_schedule_update ON csat_survey_schedule
  FOR UPDATE TO service_role USING (true);

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
-- CSAT Survey Dispatch
-- --------------------------------------------------------------------------

-- Intentionally do not install a DB-side pg_cron job that marks rows in
-- csat_survey_schedule as sent. Updating `is_sent = true` here without going
-- through the real email delivery path would cause pending surveys to be
-- permanently skipped by application-side processors that select only
-- `is_sent = false` rows.
--
-- If automated dispatch is needed, schedule the application/edge send path
-- and only set `is_sent = true` after a successful send.
