-- ============================================================
-- Security fix — restrict AI Vault RPCs to service_role
-- ============================================================
-- The AI API key Vault functions added in 017_ai_features.sql were created
-- without revoking the default PUBLIC EXECUTE grant. In Supabase, PUBLIC
-- includes the `anon` and `authenticated` roles, so any holder of the public
-- anon key could call these SECURITY DEFINER functions over PostgREST RPC and
-- retrieve (or overwrite/delete) the decrypted AI provider API key, e.g.:
--   POST /rest/v1/rpc/get_ai_api_key
--
-- These RPCs are only ever called server-side via the service-role client
-- (src/lib/ai/client.ts and src/lib/actions/ai.ts), so locking EXECUTE down to
-- service_role does not affect legitimate usage. This mirrors the treatment
-- already applied to the tier and OAuth Vault RPCs in migrations 018 and 019.

REVOKE EXECUTE ON FUNCTION store_ai_api_key(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_ai_api_key() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION delete_ai_api_key() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION store_ai_api_key(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_ai_api_key() TO service_role;
GRANT EXECUTE ON FUNCTION delete_ai_api_key() TO service_role;
