-- ============================================================
-- 012 — Agent dashboard ranking: Auto mode and asc/desc sorts (#7)
-- ============================================================
-- 1. agent_tickets view: two more trailing columns for the "Auto" sort:
--      * is_enterprise  — the ticket's License Status custom field is
--                         "Enterprise" (the AnswerDesk import's field; NULL
--                         when the field is not set);
--      * priority_rank  — the higher of urgency and severity, 1 (low) to
--                         4 (critical).
--    Same columns as 009 otherwise, in the same order (security_invoker).
-- 2. The stored agent-dashboard filter template gets the new Sort By choices
--    (Last Modified oldest first, Customer Activity newest/oldest first, Auto),
--    appended to the `sort` question when it has no "auto" choice yet, so a
--    re-run changes nothing. Mirrors agent-dashboard-template.json.

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
      AND au.role IN ('agent', 'admin')) AS last_agent_activity_at,
  (t.custom_fields ->> 'License Status') = 'Enterprise' AS is_enterprise,
  GREATEST(
    CASE t.urgency WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END,
    CASE t.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END
  ) AS priority_rank
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

DO $$
DECLARE
  v_raw TEXT;
  v_tpl JSONB;
  v_path TEXT[];
  v_idx INT;
BEGIN
  SELECT value INTO v_raw FROM public.app_settings WHERE key = 'survey_agent_dashboard_template';
  IF v_raw IS NULL THEN
    RETURN;
  END IF;
  BEGIN
    v_tpl := v_raw::jsonb;
  EXCEPTION WHEN others THEN
    RETURN;
  END;
  IF jsonb_typeof(v_tpl #> '{pages,0,elements}') <> 'array' THEN
    RETURN;
  END IF;

  SELECT i - 1 INTO v_idx
  FROM jsonb_array_elements(v_tpl #> '{pages,0,elements}') WITH ORDINALITY AS e(el, i)
  WHERE el ->> 'name' = 'sort' AND jsonb_typeof(el -> 'choices') = 'array'
  LIMIT 1;
  IF v_idx IS NULL THEN
    RETURN;
  END IF;
  v_path := ARRAY['pages', '0', 'elements', v_idx::text, 'choices'];
  IF jsonb_path_exists(v_tpl #> v_path, '$[*] ? (@.value == "auto")') THEN
    RETURN;
  END IF;

  v_tpl := jsonb_set(v_tpl, v_path, (v_tpl #> v_path) || '[
    {"value":"updated_asc","text":"Last Modified (oldest first)"},
    {"value":"activated","text":"Customer Activity"},
    {"value":"activated_asc","text":"Customer Activity (oldest first)"},
    {"value":"auto","text":"Auto (Enterprise, priority, recent)"}
  ]'::jsonb);

  UPDATE public.app_settings
  SET value = v_tpl::text, updated_at = now()
  WHERE key = 'survey_agent_dashboard_template';
END
$$;

NOTIFY pgrst, 'reload schema';
