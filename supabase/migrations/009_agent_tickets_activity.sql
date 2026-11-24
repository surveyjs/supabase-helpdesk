-- ============================================================
-- 009 — agent_tickets: last customer / agent activity (#104)
-- ============================================================
-- The Agent Dashboard shows when the customer last "activated" a ticket and
-- when a support agent last updated it, as precise relative times. Adds two
-- columns to the agent_tickets view:
--   * last_user_activity_at  — newest non-draft post/comment by a non-agent,
--                              or the ticket's creation time;
--   * last_agent_activity_at — newest non-draft reply/comment by an agent
--                              (internal notes excluded), NULL if none.
-- The view keeps security_invoker, so RLS still applies to the reader.
-- Same columns as in 001, in the same order, plus the two new ones at the end.
-- View-only change: no table data changes. Re-runnable.

DROP VIEW IF EXISTS public.agent_tickets;

CREATE VIEW public.agent_tickets WITH (security_invoker = true) AS
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
  (SELECT count(*) FROM posts WHERE ticket_id = t.id AND post_type = 'post') AS post_count,
  COALESCE(
    (SELECT max(po.created_at)
       FROM posts po
       JOIN profiles au ON au.id = po.author_id
      WHERE po.ticket_id = t.id
        AND NOT po.is_draft
        AND au.role = 'user'),
    t.created_at
  ) AS last_user_activity_at,
  (SELECT max(po.created_at)
     FROM posts po
     JOIN profiles au ON au.id = po.author_id
    WHERE po.ticket_id = t.id
      AND NOT po.is_draft
      AND po.post_type <> 'note'
      AND au.role IN ('agent', 'admin')) AS last_agent_activity_at
FROM tickets t
JOIN profiles p ON t.creator_id = p.id
LEFT JOIN subscription_tiers st ON st.id = p.tier_id
LEFT JOIN teams tm ON p.team_id = tm.id
LEFT JOIN profiles ap ON t.assigned_agent_id = ap.id
LEFT JOIN ticket_types tt ON t.type_id = tt.id
LEFT JOIN categories c ON t.category_id = c.id;

-- Same grants as every other relation (see 002); re-created views lose them
-- on instances without the default privileges.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_tickets TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
