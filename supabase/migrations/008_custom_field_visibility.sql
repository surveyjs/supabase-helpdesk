-- ============================================================
-- 008 — Custom field visibility: agents-only and New Ticket form (#103)
-- ============================================================
-- Every custom field used to be shown to everyone and asked on the New Ticket
-- form, so data agents maintain (the imported "License Status" and
-- "Is License Owner") appeared on customers' and agents' create forms and was
-- editable by the ticket owner. Two per-field flags, set in Admin → Custom
-- Fields:
--   * show_on_create — ask for the field on the New Ticket form (default true,
--     the old behaviour);
--   * agent_only — only agents see and edit the field (default false).
--
-- The two license fields created by the AnswerDesk import
-- (scripts/answerdesk) get agent_only = true, show_on_create = false. That
-- happens only in the run that adds the columns, so re-running the migration
-- never undoes an admin's later choice. Pre-existing columns and rows are not
-- changed otherwise.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'custom_fields' AND column_name = 'agent_only'
  ) THEN
    ALTER TABLE public.custom_fields
      ADD COLUMN agent_only BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN show_on_create BOOLEAN NOT NULL DEFAULT true;

    UPDATE public.custom_fields
    SET agent_only = true, show_on_create = false
    WHERE name IN ('License Status', 'Is License Owner');
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
