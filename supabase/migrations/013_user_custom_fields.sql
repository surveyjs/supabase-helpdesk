-- ============================================================
-- 013 — Custom fields on users, not only on tickets (#103)
-- ============================================================
-- Admins define custom fields in Admin > Custom Fields. Until now they were
-- all ticket fields; a field can now also apply to users (e.g. a customer's
-- License Status), with the same visibility choice as ticket fields:
--   * agent_only = true  -> staff only;
--   * agent_only = false -> staff and the user it belongs to.
-- Only staff edit user field values.
--
-- Values live in their own table, not in profiles (which every signed-in
-- user can read), so RLS can keep staff-only values from customers. Rows
-- reference the field by id: renaming a field needs no data rewrite, and
-- deleting it removes its values.
--
-- Schema-only: existing fields stay ticket fields. Re-runnable.

ALTER TABLE public.custom_fields
  ADD COLUMN IF NOT EXISTS applies_to TEXT NOT NULL DEFAULT 'ticket';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_fields_applies_to_check') THEN
    ALTER TABLE public.custom_fields
      ADD CONSTRAINT custom_fields_applies_to_check CHECK (applies_to IN ('ticket', 'user'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.user_field_values (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_user_field_values_field ON public.user_field_values (field_id);

ALTER TABLE public.user_field_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_field_values_select ON public.user_field_values;
CREATE POLICY user_field_values_select ON public.user_field_values
  FOR SELECT TO authenticated USING (
    is_agent()
    OR (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.custom_fields f
        WHERE f.id = user_field_values.field_id AND NOT f.agent_only
      )
    )
  );

DROP POLICY IF EXISTS user_field_values_insert ON public.user_field_values;
CREATE POLICY user_field_values_insert ON public.user_field_values
  FOR INSERT TO authenticated WITH CHECK (is_agent());

DROP POLICY IF EXISTS user_field_values_update ON public.user_field_values;
CREATE POLICY user_field_values_update ON public.user_field_values
  FOR UPDATE TO authenticated USING (is_agent()) WITH CHECK (is_agent());

DROP POLICY IF EXISTS user_field_values_delete ON public.user_field_values;
CREATE POLICY user_field_values_delete ON public.user_field_values
  FOR DELETE TO authenticated USING (is_agent());

-- Same grants as every other table (see 002); RLS decides row access.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_field_values TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
