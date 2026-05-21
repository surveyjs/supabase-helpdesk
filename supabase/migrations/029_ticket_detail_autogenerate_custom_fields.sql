-- Backfill `autoGenerateCustomFields` on ticket-detail SurveyJS template
-- wrappers. The wrapper is persisted as a TEXT column holding a JSON
-- object; we round-trip through JSONB to set the missing key to TRUE
-- when not already present. Rows whose `value` is not valid JSON or is
-- not a JSON object are skipped (logged via NOTICE) to keep the
-- migration idempotent and safe against historical/corrupt rows.
DO $$
DECLARE
  r RECORD;
  parsed jsonb;
BEGIN
  FOR r IN
    SELECT key, value FROM app_settings
    WHERE key IN (
      'survey_ticket_detail_agent_template',
      'survey_ticket_detail_user_template'
    )
      AND value IS NOT NULL
  LOOP
    BEGIN
      parsed := r.value::jsonb;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipping app_settings.% — value is not valid JSON', r.key;
      CONTINUE;
    END;

    IF jsonb_typeof(parsed) = 'object'
       AND NOT (parsed ? 'autoGenerateCustomFields') THEN
      UPDATE app_settings
      SET
        value = (parsed || jsonb_build_object('autoGenerateCustomFields', true))::text,
        updated_at = now()
      WHERE key = r.key;
    END IF;
  END LOOP;
END $$;
