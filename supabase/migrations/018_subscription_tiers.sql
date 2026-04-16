-- ============================================================
-- Phase 20 — Subscription Tiers
-- ============================================================

-- Tier definitions
CREATE TABLE subscription_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE CHECK (
    char_length(key) BETWEEN 1 AND 50
    AND key ~ '^[a-z0-9](-?[a-z0-9])*$'
  ),
  display_name TEXT NOT NULL CHECK (char_length(display_name) <= 100),
  color TEXT NOT NULL DEFAULT 'gray',
  icon TEXT DEFAULT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Capability overrides (each boolean, default false)
  cap_change_visibility BOOLEAN NOT NULL DEFAULT false,
  cap_set_severity BOOLEAN NOT NULL DEFAULT false,
  cap_change_status BOOLEAN NOT NULL DEFAULT false,
  cap_change_type BOOLEAN NOT NULL DEFAULT false,
  cap_add_remove_tags BOOLEAN NOT NULL DEFAULT false,
  -- Per-tier limit overrides (null = use global default)
  limit_ticket_rate INTEGER DEFAULT NULL,
  limit_max_file_size INTEGER DEFAULT NULL CHECK (limit_max_file_size IS NULL OR limit_max_file_size <= 52428800),
  limit_max_files_per_post INTEGER DEFAULT NULL CHECK (limit_max_files_per_post IS NULL OR limit_max_files_per_post <= 20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE subscription_tiers ENABLE ROW LEVEL SECURITY;

-- Everyone can read tier definitions (needed for display pills)
CREATE POLICY subscription_tiers_select ON subscription_tiers
  FOR SELECT USING (true);

-- Only admins can manage tiers
CREATE POLICY subscription_tiers_insert ON subscription_tiers
  FOR INSERT WITH CHECK (is_admin());
CREATE POLICY subscription_tiers_update ON subscription_tiers
  FOR UPDATE USING (is_admin());
CREATE POLICY subscription_tiers_delete ON subscription_tiers
  FOR DELETE USING (is_admin());

-- User tier assignments (on profiles table)
ALTER TABLE profiles
  ADD COLUMN tier_id UUID REFERENCES subscription_tiers(id) ON DELETE SET NULL,
  ADD COLUMN tier_expires_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX idx_profiles_tier_id ON profiles (tier_id);

-- Helper function: check if current user has a specific tier capability
CREATE OR REPLACE FUNCTION user_has_tier_capability(capability text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_tier_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_is_blocked BOOLEAN;
  v_has_cap BOOLEAN;
BEGIN
  -- Get the current user's tier and blocked status
  SELECT tier_id, tier_expires_at, is_blocked INTO v_tier_id, v_expires_at, v_is_blocked
  FROM profiles
  WHERE id = auth.uid();

  -- Blocked users cannot exercise tier capabilities
  IF v_is_blocked THEN
    RETURN false;
  END IF;

  -- No tier assigned
  IF v_tier_id IS NULL THEN
    RETURN false;
  END IF;

  -- Tier expired
  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RETURN false;
  END IF;

  -- Check the specific capability (validate capability name to prevent SQL injection)
  IF capability NOT IN ('change_visibility', 'set_severity', 'change_status', 'change_type', 'add_remove_tags') THEN
    RETURN false;
  END IF;

  EXECUTE format(
    'SELECT cap_%s FROM subscription_tiers WHERE id = $1',
    capability
  ) INTO v_has_cap USING v_tier_id;

  RETURN COALESCE(v_has_cap, false);
END;
$$;

-- ============================================================
-- Recreate agent_tickets VIEW with tier data
-- ============================================================
DROP VIEW IF EXISTS agent_tickets;

CREATE VIEW agent_tickets WITH (security_invoker = true) AS
SELECT
  t.*,
  p.display_name AS creator_display_name,
  p.email AS creator_email,
  p.team_id AS creator_team_id,
  tm.name AS creator_team_name,
  p.tier_id AS creator_tier_id,
  st.key AS creator_tier_key,
  st.display_name AS creator_tier_display_name,
  st.color AS creator_tier_color,
  st.icon AS creator_tier_icon,
  CASE
    WHEN p.tier_id IS NULL THEN false
    WHEN p.tier_expires_at IS NOT NULL AND p.tier_expires_at < now() THEN false
    ELSE true
  END AS creator_tier_active,
  ap.display_name AS agent_display_name,
  tt.name AS type_name,
  c.name AS category_name,
  (SELECT count(*) FROM posts WHERE ticket_id = t.id AND post_type = 'post') AS post_count
FROM tickets t
JOIN profiles p ON t.creator_id = p.id
LEFT JOIN subscription_tiers st ON st.id = p.tier_id
LEFT JOIN teams tm ON p.team_id = tm.id
LEFT JOIN profiles ap ON t.assigned_agent_id = ap.id
LEFT JOIN ticket_types tt ON t.type_id = tt.id
LEFT JOIN categories c ON t.category_id = c.id;

-- ============================================================
-- Extend RLS policies for tier capability overrides
-- ============================================================

-- ticket_tags: allow users with cap_add_remove_tags to manage tags on own tickets
DROP POLICY IF EXISTS ticket_tags_insert ON ticket_tags;
CREATE POLICY ticket_tags_insert ON ticket_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    is_agent()
    OR (
      EXISTS (SELECT 1 FROM tickets WHERE id = ticket_tags.ticket_id AND creator_id = auth.uid())
      AND user_has_tier_capability('add_remove_tags')
    )
  );

DROP POLICY IF EXISTS ticket_tags_delete ON ticket_tags;
CREATE POLICY ticket_tags_delete ON ticket_tags
  FOR DELETE TO authenticated
  USING (
    is_agent()
    OR (
      EXISTS (SELECT 1 FROM tickets WHERE id = ticket_tags.ticket_id AND creator_id = auth.uid())
      AND user_has_tier_capability('add_remove_tags')
    )
  );

-- ============================================================
-- Vault RPC functions for tier API secret
-- ============================================================

CREATE OR REPLACE FUNCTION store_tier_api_secret(key_value TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'tier_api_secret';
  PERFORM vault.create_secret(key_value, 'tier_api_secret', 'External tier assignment API shared secret');
END;
$$;

CREATE OR REPLACE FUNCTION get_tier_api_secret()
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
  WHERE name = 'tier_api_secret'
  LIMIT 1;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION delete_tier_api_secret()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'tier_api_secret';
END;
$$;

-- Restrict vault RPCs to service_role only (called from server-side code)
REVOKE EXECUTE ON FUNCTION store_tier_api_secret(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_tier_api_secret() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION delete_tier_api_secret() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION store_tier_api_secret(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_tier_api_secret() TO service_role;
GRANT EXECUTE ON FUNCTION delete_tier_api_secret() TO service_role;

-- ============================================================
-- Harden profiles_update RLS to prevent tier self-assignment
-- ============================================================
DROP POLICY IF EXISTS profiles_update ON profiles;

CREATE POLICY profiles_update ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
    AND is_blocked = (SELECT is_blocked FROM profiles WHERE id = auth.uid())
    AND email = (SELECT email FROM profiles WHERE id = auth.uid())
    AND tier_id IS NOT DISTINCT FROM (SELECT tier_id FROM profiles WHERE id = auth.uid())
    AND tier_expires_at IS NOT DISTINCT FROM (SELECT tier_expires_at FROM profiles WHERE id = auth.uid())
  );
