-- ============================================================
-- Phase 21 — Authentication Modes (External SSO)
-- ============================================================

-- Authentication mode and provider configuration
INSERT INTO app_settings (key, value) VALUES
  ('auth_mode', 'built-in'),                  -- 'built-in' or 'external'
  -- Social OAuth providers (built-in mode)
  ('auth_google_enabled', 'false'),
  ('auth_github_enabled', 'false'),
  ('auth_microsoft_enabled', 'false'),
  ('auth_microsoft_tenant_id', ''),
  ('auth_gitlab_enabled', 'false'),
  ('auth_gitlab_instance_url', ''),            -- optional self-hosted URL
  -- External OAuth/OIDC provider
  ('auth_external_provider_name', ''),         -- display name for login button
  ('auth_external_issuer_url', ''),            -- OIDC discovery URL
  ('auth_external_scopes', 'openid email profile'),
  ('auth_external_auto_redirect', 'false')     -- auto-redirect to external provider
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Vault RPC functions for OAuth credential management
-- ============================================================

-- Store an OAuth credential in Vault (generic helper)
CREATE OR REPLACE FUNCTION store_oauth_secret(secret_name TEXT, secret_value TEXT, secret_description TEXT DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = secret_name;
  PERFORM vault.create_secret(secret_value, secret_name, secret_description);
END;
$$;

-- Retrieve an OAuth credential from Vault (returns decrypted value)
CREATE OR REPLACE FUNCTION get_oauth_secret(secret_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result TEXT;
BEGIN
  SELECT decrypted_secret INTO result
  FROM vault.decrypted_secrets
  WHERE name = secret_name
  LIMIT 1;
  RETURN result;
END;
$$;

-- Delete an OAuth credential from Vault
CREATE OR REPLACE FUNCTION delete_oauth_secret(secret_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = secret_name;
END;
$$;

-- Check if an OAuth credential exists in Vault (returns boolean)
CREATE OR REPLACE FUNCTION has_oauth_secret(secret_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM vault.secrets WHERE name = secret_name) INTO found;
  RETURN found;
END;
$$;

-- Restrict Vault helper functions to service_role only
REVOKE EXECUTE ON FUNCTION store_oauth_secret(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_oauth_secret(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION delete_oauth_secret(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION has_oauth_secret(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION store_oauth_secret(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_oauth_secret(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION delete_oauth_secret(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION has_oauth_secret(TEXT) TO service_role;
