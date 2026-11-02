-- ============================================================
-- 003 — Schema version RPC for the app's startup check
-- ============================================================
-- The app refuses to start unless the database has exactly the migrations
-- shipped in its image (docker/check-schema.mjs). It reads them through this
-- function over the Data API with the service_role key, so the running server
-- needs no database credentials; only the one-off `migrate` command has them.
-- Re-runnable: CREATE OR REPLACE, REVOKE/GRANT are idempotent.

CREATE OR REPLACE FUNCTION public.schema_migration_versions()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;
  RETURN ARRAY(SELECT version FROM supabase_migrations.schema_migrations ORDER BY version);
END;
$$;

-- Instances created under Supabase's OLD default privileges grant EXECUTE on
-- every new function to anon/authenticated explicitly (see 002), so revoke from
-- them by name, not only from PUBLIC.
REVOKE EXECUTE ON FUNCTION public.schema_migration_versions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schema_migration_versions() TO service_role;

NOTIFY pgrst, 'reload schema';
