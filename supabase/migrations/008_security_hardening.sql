-- ============================================================
-- Phase 10 — Security Hardening
-- ============================================================

-- C1: Restrict profiles_update RLS policy to prevent privilege escalation.
-- Users must not be able to change their own role, email, or is_blocked status.
-- Only display_name is safe to self-update.
DROP POLICY IF EXISTS profiles_update ON profiles;

CREATE POLICY profiles_update ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Prevent changing sensitive columns via RLS:
    -- role must remain unchanged
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
    -- is_blocked must remain unchanged
    AND is_blocked = (SELECT is_blocked FROM profiles WHERE id = auth.uid())
    -- email must remain unchanged (managed by auth.users, not direct profile update)
    AND email = (SELECT email FROM profiles WHERE id = auth.uid())
  );

-- M7: Fix ticket_tags_select to respect ticket privacy.
-- Previously, all authenticated users could see all ticket_tags rows,
-- leaking tag associations on private tickets.
DROP POLICY IF EXISTS ticket_tags_select ON ticket_tags;

CREATE POLICY ticket_tags_select ON ticket_tags
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tickets t WHERE t.id = ticket_tags.ticket_id AND (
        is_agent()
        OR t.creator_id = auth.uid()
        OR NOT t.is_private
        OR is_teammate(t.creator_id)
      )
    )
  );
