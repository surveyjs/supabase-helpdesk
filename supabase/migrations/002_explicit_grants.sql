-- ============================================================
-- 002 — Explicit Data API grants
-- ============================================================
-- Supabase no longer grants new `public` objects to the Data API roles
-- automatically (local CLI >= 2.106 / `[api] auto_expose_new_tables = false`;
-- hosted: new projects since 2026-05-30, all projects from 2026-10-30):
-- https://github.com/orgs/supabase/discussions/45329
-- Without these grants every supabase-js / PostgREST call fails with 42501
-- ("permission denied for table ..."), even for service_role.
--
-- Tables and sequences: grant what PostgREST needs. Row access is still decided
-- by RLS, which 001 enables on every table. Instances created under the old
-- defaults already hold ALL on these objects; this migration does not revoke
-- that, so it is a no-op for their tables.

-- All 37 tables plus the agent_tickets view (ALL TABLES includes views).
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO anon, authenticated, service_role;

-- tickets_id_seq, kb_articles_id_seq (BIGSERIAL).
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;

-- Same for tables/sequences created by later migrations (run as postgres).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

-- Functions: default EXECUTE for anon/authenticated is deliberately NOT
-- restored. Ordinary functions (RLS helpers, RPCs) remain callable through
-- PostgreSQL's built-in PUBLIC grant.
--
-- Vault RPCs must stay service_role-only. Under the OLD defaults anon and
-- authenticated received an explicit EXECUTE on every new function, which
-- 001's `REVOKE ... FROM PUBLIC` does not remove — on such instances anyone
-- holding the public anon key could read secrets via POST /rest/v1/rpc/...
-- No-op on databases created under the new defaults.
REVOKE EXECUTE ON FUNCTION
  public.store_ai_api_key(text),
  public.get_ai_api_key(),
  public.delete_ai_api_key(),
  public.store_tier_api_secret(text),
  public.get_tier_api_secret(),
  public.delete_tier_api_secret(),
  public.store_oauth_secret(text, text, text),
  public.get_oauth_secret(text),
  public.delete_oauth_secret(text),
  public.has_oauth_secret(text)
  FROM PUBLIC, anon, authenticated;
