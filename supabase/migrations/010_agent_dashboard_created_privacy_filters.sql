-- ============================================================
-- 010 — Agent dashboard filters: Created date range and Visibility (#113)
-- ============================================================
-- Adds four questions to the stored copy of the agent-dashboard filter
-- template (seeded by 001): "Created" (Any time / Today / Yesterday / Last 7
-- days / Last 30 days / Last 6 months / Last year / Custom range), "Visibility"
-- (All / Private / Public), and the From / To dates shown for a custom range.
-- Mirrors src/components/features/survey/form-json/admin/agent-dashboard-template.json.
--
-- The questions are appended to the first page's elements only when the
-- template parses, has that array, and has no "created" question yet, so a
-- re-run changes nothing and a template an admin restructured is left alone
-- (they can add the questions in Admin > Agent Dashboard).

DO $$
DECLARE
  v_raw TEXT;
  v_tpl JSONB;
BEGIN
  SELECT value INTO v_raw FROM public.app_settings WHERE key = 'survey_agent_dashboard_template';
  IF v_raw IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    v_tpl := v_raw::jsonb;
  EXCEPTION WHEN others THEN
    RETURN; -- not JSON: the app falls back to the bundled template anyway
  END;

  IF jsonb_typeof(v_tpl #> '{pages,0,elements}') <> 'array'
     OR jsonb_path_exists(v_tpl, '$.** ? (@.name == "created")') THEN
    RETURN;
  END IF;

  v_tpl := jsonb_set(
    v_tpl,
    '{pages,0,elements}',
    (v_tpl #> '{pages,0,elements}') || '[
      {"type":"dropdown","name":"created","title":"Created","choices":[
        {"value":"","text":"Any time"},{"value":"today","text":"Today"},
        {"value":"yesterday","text":"Yesterday"},{"value":"7d","text":"Last 7 days"},
        {"value":"30d","text":"Last 30 days"},{"value":"6m","text":"Last 6 months"},
        {"value":"1y","text":"Last year"},{"value":"custom","text":"Custom range"}]},
      {"type":"dropdown","name":"privacy","title":"Visibility","startWithNewLine":false,"choices":[
        {"value":"","text":"All"},{"value":"private","text":"Private"},{"value":"public","text":"Public"}]},
      {"type":"text","name":"created_from","title":"From","inputType":"date","visibleIf":"{created} = ''custom''"},
      {"type":"text","name":"created_to","title":"To","inputType":"date","startWithNewLine":false,"visibleIf":"{created} = ''custom''"}
    ]'::jsonb
  );

  UPDATE public.app_settings
  SET value = v_tpl::text, updated_at = now()
  WHERE key = 'survey_agent_dashboard_template';
END
$$;
