-- ============================================================
-- 006 — Agent dashboard filter template: "Open" label, real default sort
-- ============================================================
-- The stored copy of the agent-dashboard SurveyJS template (seeded by 001)
-- called the "open" status "Active" while every status badge says "Open", and
-- its "Last Modified" sort used the empty value "", which SurveyJS treats as
-- no value, so Sort By showed the "Select..." placeholder. Mirrors
-- src/components/features/survey/form-json/admin/agent-dashboard-template.json.
--
-- Only the exact seeded fragments are replaced, so a template an admin has
-- customised (re-saved in another shape) is left alone. Re-runnable: once
-- replaced, the fragments no longer match.

UPDATE public.app_settings
SET
  value = replace(
    replace(
      value,
      '{"value":"open","text":"Active"}',
      '{"value":"open","text":"Open"}'
    ),
    '"defaultValue":"","allowClear":false,"choices":[{"value":"","text":"Last Modified"}',
    '"defaultValue":"updated","allowClear":false,"choices":[{"value":"updated","text":"Last Modified"}'
  ),
  updated_at = now()
WHERE key = 'survey_agent_dashboard_template'
  AND (
    value LIKE '%{"value":"open","text":"Active"}%'
    OR value LIKE '%"defaultValue":"","allowClear":false,"choices":[{"value":"","text":"Last Modified"}%'
  );
