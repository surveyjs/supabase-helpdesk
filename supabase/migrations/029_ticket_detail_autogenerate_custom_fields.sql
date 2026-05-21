-- Backfill `autoGenerateCustomFields` on ticket-detail SurveyJS template
-- wrappers. The wrapper is persisted as a TEXT column holding a JSON
-- object; we round-trip through JSONB to set the missing key to TRUE
-- when not already present.
UPDATE app_settings
SET
  value = (
    (value::jsonb) || jsonb_build_object('autoGenerateCustomFields', true)
  )::text,
  updated_at = now()
WHERE key IN (
  'survey_ticket_detail_agent_template',
  'survey_ticket_detail_user_template'
)
  AND value IS NOT NULL
  AND NOT ((value::jsonb) ? 'autoGenerateCustomFields');
