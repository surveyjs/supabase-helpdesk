-- ============================================================
-- 005 — Describe schema_migration_versions()
-- ============================================================
-- Documents the RPC of 003 for anyone reading the schema in Studio. Changes
-- metadata only, no data. Re-runnable: COMMENT ON replaces the comment.

COMMENT ON FUNCTION public.schema_migration_versions() IS
  'Applied migration versions; read by the app''s startup schema check (docker/check-schema.mjs).';
