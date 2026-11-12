-- Step 3 of the AnswerDesk import: load the staging files written by
-- prepare.mjs (copied into the DB container at /tmp/adimport) and insert them
-- into the app tables. Run as a superuser (supabase_admin) in one transaction.
--
-- Idempotent: id maps live in the `adimport` schema (not exposed by the API),
-- so re-running, or re-running with a larger sample, only adds what is new.
--   adimport.user_map    source Users.Id      -> auth.users.id
--   adimport.ticket_map  source Tickets.Id    -> tickets.id (BIGSERIAL)
--   adimport.category_map / type_map / tag_map (source int ids)
--
-- A source user is linked to an EXISTING account (instead of creating one)
-- when the account has the same id, the same auth.surveyjs.io subject
-- (custom:external identity), or the same email.

\set ON_ERROR_STOP on
\timing off
SET client_min_messages = warning;

BEGIN;

CREATE SCHEMA IF NOT EXISTS adimport;
REVOKE ALL ON SCHEMA adimport FROM PUBLIC;

CREATE TABLE IF NOT EXISTS adimport.user_map (
  legacy_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  created_by_import BOOLEAN NOT NULL,
  linked_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS adimport.ticket_map (legacy_id UUID PRIMARY KEY, ticket_id BIGINT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS adimport.category_map (legacy_id INT PRIMARY KEY, category_id UUID NOT NULL);
CREATE TABLE IF NOT EXISTS adimport.type_map (legacy_id INT PRIMARY KEY, type_id UUID NOT NULL);
CREATE TABLE IF NOT EXISTS adimport.identity_added (identity_id UUID PRIMARY KEY);
CREATE TABLE IF NOT EXISTS adimport.tag_map (legacy_id INT PRIMARY KEY, tag_id UUID NOT NULL);
CREATE TABLE IF NOT EXISTS adimport.runs (
  id SERIAL PRIMARY KEY, ran_at TIMESTAMPTZ NOT NULL DEFAULT now(), summary JSONB
);

-- ------------------------------------------------------------------
-- Staging tables (recreated every run)
-- ------------------------------------------------------------------
DROP TABLE IF EXISTS adimport.s_users, adimport.s_identities, adimport.s_categories, adimport.s_types,
  adimport.s_tags, adimport.s_custom_fields, adimport.s_tickets, adimport.s_posts, adimport.s_attachments,
  adimport.s_ticket_tags, adimport.s_followers, adimport.s_csat;

CREATE TABLE adimport.s_users (id UUID, email TEXT, display_name TEXT, role TEXT, is_blocked BOOLEAN, created_at TIMESTAMPTZ, has_sso BOOLEAN);
CREATE TABLE adimport.s_identities (user_id UUID, provider TEXT, provider_id TEXT, email TEXT, created_at TIMESTAMPTZ);
CREATE TABLE adimport.s_categories (legacy_id INT, name TEXT);
CREATE TABLE adimport.s_types (legacy_id INT, name TEXT, is_default BOOLEAN);
CREATE TABLE adimport.s_tags (legacy_id INT, name TEXT);
CREATE TABLE adimport.s_custom_fields (name TEXT, field_type TEXT, options JSONB, display_order INT);
CREATE TABLE adimport.s_tickets (
  legacy_id UUID, title TEXT, status TEXT, urgency TEXT, severity TEXT, is_private BOOLEAN,
  type_legacy INT, category_legacy INT, creator UUID, assignee UUID, duplicate_of UUID, cloned_from UUID,
  custom_fields JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
);
CREATE TABLE adimport.s_posts (
  id UUID, ticket_legacy UUID, author UUID, parent_post_id UUID, parent_comment_id UUID, post_type TEXT,
  body TEXT, is_private BOOLEAN, is_original BOOLEAN, edited_at TIMESTAMPTZ, created_at TIMESTAMPTZ
);
CREATE TABLE adimport.s_attachments (
  id UUID, post_id UUID, uploader UUID, blob_id UUID, filename TEXT, file_size BIGINT, mime_type TEXT, created_at TIMESTAMPTZ
);
CREATE TABLE adimport.s_ticket_tags (ticket_legacy UUID, tag_legacy INT);
CREATE TABLE adimport.s_followers (ticket_legacy UUID, user_id UUID);
CREATE TABLE adimport.s_csat (ticket_legacy UUID, rating INT, comment TEXT, submitted_at TIMESTAMPTZ);

COPY adimport.s_users FROM '/tmp/adimport/users.tsv';
COPY adimport.s_identities FROM '/tmp/adimport/identities.tsv';
COPY adimport.s_categories FROM '/tmp/adimport/categories.tsv';
COPY adimport.s_types FROM '/tmp/adimport/ticket_types.tsv';
COPY adimport.s_tags FROM '/tmp/adimport/tags.tsv';
COPY adimport.s_custom_fields FROM '/tmp/adimport/custom_fields.tsv';
COPY adimport.s_tickets FROM '/tmp/adimport/tickets.tsv';
COPY adimport.s_posts FROM '/tmp/adimport/posts.tsv';
COPY adimport.s_attachments FROM '/tmp/adimport/attachments.tsv';
COPY adimport.s_ticket_tags FROM '/tmp/adimport/ticket_tags.tsv';
COPY adimport.s_followers FROM '/tmp/adimport/followers.tsv';
COPY adimport.s_csat FROM '/tmp/adimport/csat.tsv';

-- ------------------------------------------------------------------
-- 1. Users
-- ------------------------------------------------------------------
-- 1a. Link to existing accounts (same id / same SSO subject / same email).
INSERT INTO adimport.user_map (legacy_id, user_id, created_by_import, linked_by)
SELECT s.id,
       COALESCE(by_id.id, by_sub.user_id, by_email.id),
       false,
       CASE WHEN by_id.id IS NOT NULL THEN 'id' WHEN by_sub.user_id IS NOT NULL THEN 'sso-subject' ELSE 'email' END
FROM adimport.s_users s
LEFT JOIN auth.users by_id ON by_id.id = s.id
LEFT JOIN LATERAL (
  SELECT i.user_id FROM adimport.s_identities si
  JOIN auth.identities i ON i.provider = si.provider AND i.provider_id = si.provider_id
  WHERE si.user_id = s.id AND si.provider = 'custom:external'
  LIMIT 1
) by_sub ON true
LEFT JOIN LATERAL (
  SELECT u.id FROM auth.users u WHERE lower(u.email) = s.email ORDER BY u.created_at LIMIT 1
) by_email ON true
WHERE NOT EXISTS (SELECT 1 FROM adimport.user_map m WHERE m.legacy_id = s.id)
  AND COALESCE(by_id.id, by_sub.user_id, by_email.id) IS NOT NULL;

-- 1b. Create the rest. The on_auth_user_created trigger creates profiles.
CREATE TEMP TABLE new_users ON COMMIT DROP AS
SELECT s.* FROM adimport.s_users s
WHERE NOT EXISTS (SELECT 1 FROM adimport.user_map m WHERE m.legacy_id = s.id);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
  is_sso_user, is_anonymous
)
SELECT '00000000-0000-0000-0000-000000000000', n.id, 'authenticated', 'authenticated', n.email, '', n.created_at,
       '', '', '', '',
       CASE WHEN n.has_sso
         THEN jsonb_build_object('provider', 'custom:external', 'providers', jsonb_build_array('custom:external'))
         ELSE jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')) END,
       jsonb_build_object('display_name', n.display_name),
       false, n.created_at, now(), false, false
FROM new_users n;

INSERT INTO adimport.user_map (legacy_id, user_id, created_by_import, linked_by)
SELECT id, id, true, 'created' FROM new_users;

-- 1c. Identities. SSO subjects for every mapped user (unless already taken);
--     an email identity only for accounts this import created.
WITH ins AS (
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
SELECT DISTINCT ON (si.provider, si.provider_id)
       CASE WHEN si.provider = 'email' THEN m.user_id::text ELSE si.provider_id END, m.user_id,
       CASE WHEN si.provider = 'email'
         THEN jsonb_build_object('sub', m.user_id::text, 'email', si.email, 'email_verified', false, 'phone_verified', false)
         ELSE jsonb_build_object('sub', si.provider_id, 'email', si.email, 'email_verified', true, 'phone_verified', false) END,
       si.provider, si.created_at, now()
FROM adimport.s_identities si
JOIN adimport.user_map m ON m.legacy_id = si.user_id
WHERE (si.provider <> 'email' OR m.created_by_import)
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.provider = si.provider
      AND i.provider_id = CASE WHEN si.provider = 'email' THEN m.user_id::text ELSE si.provider_id END
  )
RETURNING id
)
INSERT INTO adimport.identity_added SELECT id FROM ins;

-- 1d. Profiles: role (only ever raised), blocked flag and dates for created accounts.
UPDATE public.profiles p
SET role = CASE
             WHEN p.role = 'admin' OR s.role = 'admin' THEN 'admin'
             WHEN p.role = 'agent' OR s.role = 'agent' THEN 'agent'
             ELSE 'user' END::public.user_role,
    is_blocked = CASE WHEN m.created_by_import THEN s.is_blocked ELSE p.is_blocked END,
    created_at = CASE WHEN m.created_by_import THEN s.created_at ELSE p.created_at END
FROM adimport.s_users s
JOIN adimport.user_map m ON m.legacy_id = s.id
WHERE p.id = m.user_id
  AND (p.role::text IS DISTINCT FROM s.role OR m.created_by_import);

-- ------------------------------------------------------------------
-- 2. Reference data
-- ------------------------------------------------------------------
INSERT INTO public.categories (name) SELECT name FROM adimport.s_categories ON CONFLICT (name) DO NOTHING;
INSERT INTO adimport.category_map SELECT s.legacy_id, c.id FROM adimport.s_categories s JOIN public.categories c ON c.name = s.name
ON CONFLICT (legacy_id) DO NOTHING;

INSERT INTO public.tags (name) SELECT name FROM adimport.s_tags ON CONFLICT (name) DO NOTHING;
INSERT INTO adimport.tag_map SELECT s.legacy_id, t.id FROM adimport.s_tags s JOIN public.tags t ON t.name = s.name
ON CONFLICT (legacy_id) DO NOTHING;

INSERT INTO public.ticket_types (name) SELECT name FROM adimport.s_types ON CONFLICT (name) DO NOTHING;
INSERT INTO adimport.type_map SELECT s.legacy_id, t.id FROM adimport.s_types s JOIN public.ticket_types t ON t.name = s.name
ON CONFLICT (legacy_id) DO NOTHING;
-- Decision Q8: the source types replace the seeded ones. Move the default flag,
-- then drop seeded types nothing uses.
UPDATE public.ticket_types SET is_default = false
WHERE is_default AND EXISTS (SELECT 1 FROM adimport.s_types WHERE is_default)
  AND name NOT IN (SELECT name FROM adimport.s_types WHERE is_default);
UPDATE public.ticket_types SET is_default = true
WHERE name IN (SELECT name FROM adimport.s_types WHERE is_default) AND NOT is_default;
DELETE FROM public.ticket_types t
WHERE t.name IN ('Question', 'Issue', 'Suggestion')
  AND t.name NOT IN (SELECT name FROM adimport.s_types)
  AND NOT t.is_default
  AND NOT EXISTS (SELECT 1 FROM public.tickets WHERE type_id = t.id);

INSERT INTO public.custom_fields (name, field_type, options, display_order)
SELECT name, field_type, options, display_order FROM adimport.s_custom_fields
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------------------------
-- 3. Tickets (ids allocated in creation order)
-- ------------------------------------------------------------------
CREATE TEMP TABLE new_tickets ON COMMIT DROP AS
SELECT q.*, nextval(pg_get_serial_sequence('public.tickets', 'id')) AS new_id
FROM (
  SELECT s.* FROM adimport.s_tickets s
  WHERE NOT EXISTS (SELECT 1 FROM adimport.ticket_map m WHERE m.legacy_id = s.legacy_id)
  ORDER BY s.created_at, s.legacy_id
) q;

INSERT INTO public.tickets (
  id, title, slug, status, urgency, severity, is_private, type_id, category_id,
  creator_id, assigned_agent_id, custom_fields, created_at, updated_at
)
SELECT n.new_id, n.title, public.generate_slug(n.title), n.status::public.ticket_status, n.urgency::public.priority_level,
       n.severity::public.priority_level, n.is_private,
       COALESCE(tm.type_id,
                (SELECT id FROM public.ticket_types WHERE is_default LIMIT 1),
                (SELECT id FROM public.ticket_types ORDER BY created_at LIMIT 1)),
       cm.category_id, cu.user_id, au.user_id, COALESCE(n.custom_fields, '{}'::jsonb), n.created_at, n.updated_at
FROM new_tickets n
JOIN adimport.user_map cu ON cu.legacy_id = n.creator
LEFT JOIN adimport.user_map au ON au.legacy_id = n.assignee
LEFT JOIN adimport.type_map tm ON tm.legacy_id = n.type_legacy
LEFT JOIN adimport.category_map cm ON cm.legacy_id = n.category_legacy
ORDER BY n.new_id;

INSERT INTO adimport.ticket_map (legacy_id, ticket_id)
SELECT n.legacy_id, n.new_id FROM new_tickets n WHERE EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = n.new_id);

-- Duplicate / clone links, where both ends are imported (any run).
UPDATE public.tickets t SET duplicate_of_id = d.ticket_id
FROM adimport.s_tickets s
JOIN adimport.ticket_map me ON me.legacy_id = s.legacy_id
JOIN adimport.ticket_map d ON d.legacy_id = s.duplicate_of
WHERE t.id = me.ticket_id AND t.duplicate_of_id IS NULL AND d.ticket_id <> t.id;

UPDATE public.tickets t SET cloned_from_id = c.ticket_id
FROM adimport.s_tickets s
JOIN adimport.ticket_map me ON me.legacy_id = s.legacy_id
JOIN adimport.ticket_map c ON c.legacy_id = s.cloned_from
WHERE t.id = me.ticket_id AND t.cloned_from_id IS NULL AND c.ticket_id <> t.id;

-- ------------------------------------------------------------------
-- 4. Posts
-- ------------------------------------------------------------------
INSERT INTO public.posts (
  id, ticket_id, author_id, parent_post_id, parent_comment_id, post_type, body,
  is_private, is_draft, is_original, edited_at, created_at
)
SELECT s.id, tm.ticket_id, um.user_id, s.parent_post_id, s.parent_comment_id, s.post_type::public.post_type, s.body,
       s.is_private, false, s.is_original, s.edited_at, s.created_at
FROM adimport.s_posts s
JOIN adimport.ticket_map tm ON tm.legacy_id = s.ticket_legacy
JOIN adimport.user_map um ON um.legacy_id = s.author
ORDER BY (s.parent_post_id IS NOT NULL), (s.parent_comment_id IS NOT NULL), s.created_at
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------
-- 5. Attachments (only blobs that made it into Storage)
-- ------------------------------------------------------------------
INSERT INTO public.attachments (
  id, post_id, uploader_id, storage_path, legacy_blob_id, original_filename, file_size, mime_type, created_at
)
SELECT s.id, s.post_id, COALESCE(um.user_id, p.author_id), NULL, s.blob_id, s.filename, s.file_size, s.mime_type, s.created_at
FROM adimport.s_attachments s
JOIN public.posts p ON p.id = s.post_id
LEFT JOIN adimport.user_map um ON um.legacy_id = s.uploader
WHERE EXISTS (
  SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'attachments' AND o.name = 'migrated/' || s.blob_id::text
)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------
-- 6. Tags, followers, CSAT, activity log
-- ------------------------------------------------------------------
INSERT INTO public.ticket_tags (ticket_id, tag_id)
SELECT tm.ticket_id, g.tag_id
FROM adimport.s_ticket_tags s
JOIN adimport.ticket_map tm ON tm.legacy_id = s.ticket_legacy
JOIN adimport.tag_map g ON g.legacy_id = s.tag_legacy
ON CONFLICT DO NOTHING;

INSERT INTO public.ticket_followers (ticket_id, user_id, created_at)
SELECT tm.ticket_id, um.user_id, t.created_at
FROM adimport.s_followers s
JOIN adimport.ticket_map tm ON tm.legacy_id = s.ticket_legacy
JOIN adimport.user_map um ON um.legacy_id = s.user_id
JOIN public.tickets t ON t.id = tm.ticket_id
WHERE um.user_id <> t.creator_id
ON CONFLICT DO NOTHING;

INSERT INTO public.csat_ratings (ticket_id, token, rating, comment, submitted_at, token_expires_at, is_used, created_at)
SELECT tm.ticket_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), s.rating, s.comment, s.submitted_at, s.submitted_at, true, s.submitted_at
FROM adimport.s_csat s
JOIN adimport.ticket_map tm ON tm.legacy_id = s.ticket_legacy
WHERE NOT EXISTS (SELECT 1 FROM public.csat_ratings c WHERE c.ticket_id = tm.ticket_id);

INSERT INTO public.activity_log (ticket_id, actor_id, action, details, created_at)
SELECT t.id, t.creator_id, 'created', '{}'::jsonb, t.created_at
FROM adimport.ticket_map tm
JOIN public.tickets t ON t.id = tm.ticket_id
WHERE NOT EXISTS (SELECT 1 FROM public.activity_log a WHERE a.ticket_id = t.id AND a.action = 'created');

-- ------------------------------------------------------------------
-- 7. Restore historical updated_at (post inserts bumped it to now()).
--    Triggers off for this statement only.
-- ------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
UPDATE public.tickets t
SET updated_at = GREATEST(s.updated_at, (SELECT max(p.created_at) FROM public.posts p WHERE p.ticket_id = t.id))
FROM adimport.s_tickets s
JOIN adimport.ticket_map tm ON tm.legacy_id = s.legacy_id
WHERE t.id = tm.ticket_id;
SET LOCAL session_replication_role = origin;

-- ------------------------------------------------------------------
-- 8. Summary
-- ------------------------------------------------------------------
CREATE TEMP TABLE summary ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('staged users',                    (SELECT count(*) FROM adimport.s_users)),
  ('users created (total)',           (SELECT count(*) FROM adimport.user_map WHERE created_by_import)),
  ('users linked to existing account',(SELECT count(*) FROM adimport.user_map WHERE NOT created_by_import)),
  ('agents/admins among mapped',      (SELECT count(*) FROM adimport.user_map m JOIN public.profiles p ON p.id = m.user_id WHERE p.role <> 'user')),
  ('custom:external identities',      (SELECT count(*) FROM auth.identities i JOIN adimport.user_map m ON m.user_id = i.user_id WHERE i.provider = 'custom:external')),
  ('staged tickets',                  (SELECT count(*) FROM adimport.s_tickets)),
  ('tickets imported (total)',        (SELECT count(*) FROM adimport.ticket_map)),
  ('staged posts',                    (SELECT count(*) FROM adimport.s_posts)),
  ('posts on imported tickets',       (SELECT count(*) FROM public.posts p JOIN adimport.ticket_map m ON m.ticket_id = p.ticket_id)),
  ('staged attachments',              (SELECT count(*) FROM adimport.s_attachments)),
  ('attachments imported',            (SELECT count(*) FROM public.attachments a JOIN public.posts p ON p.id = a.post_id JOIN adimport.ticket_map m ON m.ticket_id = p.ticket_id WHERE a.legacy_blob_id IS NOT NULL)),
  ('staged attachments w/o blob in Storage', (SELECT count(*) FROM adimport.s_attachments s WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'attachments' AND o.name = 'migrated/' || s.blob_id::text))),
  ('ticket tags',                     (SELECT count(*) FROM public.ticket_tags g JOIN adimport.ticket_map m ON m.ticket_id = g.ticket_id)),
  ('followers',                       (SELECT count(*) FROM public.ticket_followers f JOIN adimport.ticket_map m ON m.ticket_id = f.ticket_id)),
  ('csat ratings',                    (SELECT count(*) FROM public.csat_ratings c JOIN adimport.ticket_map m ON m.ticket_id = c.ticket_id))
) v(item, n);

INSERT INTO adimport.runs (summary) SELECT jsonb_object_agg(item, n) FROM summary;
SELECT item AS "import summary", n FROM summary;

-- Staging tables hold customer data; keep only the maps.
DROP TABLE adimport.s_users, adimport.s_identities, adimport.s_categories, adimport.s_types,
  adimport.s_tags, adimport.s_custom_fields, adimport.s_tickets, adimport.s_posts, adimport.s_attachments,
  adimport.s_ticket_tags, adimport.s_followers, adimport.s_csat;

COMMIT;

ANALYZE public.tickets;
ANALYZE public.posts;
