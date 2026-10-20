-- ============================================================
-- Upgrade-test fixtures (NOT a seed — never loaded by `supabase start`)
-- ============================================================
-- Loaded by the CI `migration-upgrade` job (.github/scripts/migration-upgrade.sh)
-- on top of seed.sql, against the BASE revision's schema, right before the
-- "before" data fingerprint is taken. New migrations must then preserve these
-- rows (or declare intended changes in supabase/upgrade-expectations.json).
--
-- Goals: production-like volume and the edge cases a real database
-- accumulates — boundary-length strings, Unicode/emoji/RTL, quotes and HTML,
-- NULLs in every optional column, merge/duplicate/clone chains, two-level
-- comment threads, drafts, private notes, orphan and legacy attachments,
-- zero-byte and multi-GB files, years-old timestamps.
--
-- Everything is generated deterministically from row numbers (no random()),
-- so a failure reproduces exactly. Fixture rows use their own ID ranges and an
-- @upgrade-fixture.test email domain to stay clear of seed and test data:
--   users        f1000000-0000-4000-8000-<n>     (300)
--   teams        f3000000-0000-4000-8000-<n>     (20)
--   categories   f4000000-0000-4000-8000-<n>     (10)
--   tags         f5000000-0000-4000-8000-<n>     (40)
--   tickets      ids 900001..903000              (3000)
--   posts        f2<kind>00000-...               (~15 000)
--   attachments  f6000000-0000-4000-8000-<n>     (2000)
--
-- Keep this file in sync with the schema it targets: it runs against the base
-- revision, so a column added by a new migration must not be referenced here
-- until that migration is on main.

SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.fx_uuid(prefix TEXT, n BIGINT) RETURNS UUID
LANGUAGE sql IMMUTABLE AS $$ SELECT (prefix || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

-- ---------------------------------------------------------------------------
-- Teams and categories
-- ---------------------------------------------------------------------------
INSERT INTO teams (id, name, created_at)
SELECT pg_temp.fx_uuid('f3000000', n),
       CASE n % 4
         WHEN 0 THEN 'Fixture team ' || n
         WHEN 1 THEN 'Команда поддержки №' || n || ' 🛟'
         WHEN 2 THEN 'فريق الدعم ' || n            -- RTL
         ELSE left('Fixture team with a deliberately long name ' || n || ' ' || repeat('x', 100), 100)
       END,
       now() - make_interval(days => n * 30)
FROM generate_series(1, 20) n;

INSERT INTO categories (id, name)
SELECT pg_temp.fx_uuid('f4000000', n),
       CASE n WHEN 1 THEN 'Billing & "Invoices"' WHEN 2 THEN 'Ünïcödé — категория' WHEN 3 THEN left(repeat('Long category ', 10), 100)
              ELSE 'Fixture category ' || n END
FROM generate_series(1, 10) n;

-- ---------------------------------------------------------------------------
-- Users: auth.users -> profiles via the handle_new_user trigger
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, email_change, reauthentication_token, email_change_confirm_status
)
SELECT pg_temp.fx_uuid('f1000000', n),
       '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated',
       CASE WHEN n % 50 = 0 THEN 'Mixed.Case+tag' || n || '@Upgrade-Fixture.test'
            ELSE 'user' || n || '@upgrade-fixture.test' END,
       '', -- nobody signs in as a fixture user
       CASE WHEN n % 9 = 0 THEN NULL ELSE now() - make_interval(days => n) END,
       now() - make_interval(days => n * 4), now() - make_interval(days => n),
       CASE n % 6
         WHEN 0 THEN jsonb_build_object('display_name', 'Zoë O''Brien-Łukasiewicz ' || n)
         WHEN 1 THEN jsonb_build_object('name', '山田 太郎 ' || n)            -- "name" fallback
         WHEN 2 THEN jsonb_build_object('display_name', 'محمد ' || n)        -- RTL
         WHEN 3 THEN jsonb_build_object('display_name', left('🙂🚀 Emoji person ' || n || ' ' || repeat('é', 100), 100))
         WHEN 4 THEN '{}'::jsonb                                              -- email-prefix fallback
         ELSE jsonb_build_object('display_name', '<b>Html</b> & "quotes" ' || n)
       END,
       '{"provider":"email","providers":["email"]}'::jsonb,
       false, false, '', '', '', '', '', '', 0
FROM generate_series(1, 300) n;

-- Roles, teams, blocked users, NULL display names, editor preference bounds.
UPDATE profiles p SET
  role = CASE WHEN f.n % 97 = 0 THEN 'admin'::user_role WHEN f.n % 20 = 0 THEN 'agent'::user_role ELSE 'user'::user_role END,
  team_id = CASE WHEN f.n % 3 = 0 THEN NULL ELSE pg_temp.fx_uuid('f3000000', f.n % 20 + 1) END,
  is_blocked = (f.n % 41 = 0),
  display_name = CASE WHEN f.n % 13 = 0 THEN NULL ELSE p.display_name END,
  editor_view_mode = (ARRAY['both', 'preview', 'editor'])[f.n % 3 + 1],
  editor_min_height_px = CASE f.n % 3 WHEN 0 THEN 120 WHEN 1 THEN 1000 ELSE 300 END,
  editor_max_height_px = CASE f.n % 3 WHEN 0 THEN 200 WHEN 1 THEN 2000 ELSE 540 END,
  tier_expires_at = CASE WHEN f.n % 7 = 0 THEN now() - interval '1 day' ELSE NULL END
FROM (SELECT n, pg_temp.fx_uuid('f1000000', n) AS id FROM generate_series(1, 300) n) f
WHERE p.id = f.id;

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
INSERT INTO tags (id, name, color)
SELECT pg_temp.fx_uuid('f5000000', n),
       CASE n % 5
         WHEN 0 THEN 'fx-tag-' || n
         WHEN 1 THEN 'метка-' || n
         WHEN 2 THEN left('fx-max-length-tag-' || n || '-' || repeat('z', 50), 50)
         WHEN 3 THEN 'fx 🏷️ ' || n
         ELSE 'fx "quoted" ' || n
       END,
       CASE WHEN n % 2 = 0 THEN '#' || lpad(to_hex(n * 400000), 6, '0') ELSE 'red' END
FROM generate_series(1, 40) n;

-- ---------------------------------------------------------------------------
-- Tickets (explicit ids so duplicate/merge/clone chains can reference them)
-- ---------------------------------------------------------------------------
INSERT INTO tickets (
  id, title, slug, status, urgency, severity, is_private, type_id, category_id,
  creator_id, assigned_agent_id, custom_fields, created_at, updated_at
)
SELECT 900000 + n,
       CASE n % 10
         WHEN 0 THEN left('Max-length title ' || n || ' ' || repeat('lorem ipsum ', 40), 300)
         WHEN 1 THEN 'Не работает вход — ошибка №' || n
         WHEN 2 THEN 'لا يمكنني تسجيل الدخول ' || n
         WHEN 3 THEN 'Emoji 🔥🐛 broken export #' || n
         WHEN 4 THEN 'Robert''); DROP TABLE tickets;-- ' || n
         WHEN 5 THEN '<script>alert(' || n || ')</script> in title'
         WHEN 6 THEN '**Markdown** _title_ `code` ' || n
         WHEN 7 THEN 'Ticket ' || n
         WHEN 8 THEN 'Tab	and spaces   ' || n
         ELSE 'Same title for many tickets'          -- duplicate titles and slugs
       END,
       CASE WHEN n % 10 = 9 THEN 'same-title-for-many-tickets' ELSE 'fixture-ticket-' || n END,
       (ARRAY['open', 'pending', 'closed'])[n % 3 + 1]::ticket_status,
       (ARRAY['low', 'medium', 'high', 'critical'])[n % 4 + 1]::priority_level,
       (ARRAY['low', 'medium', 'high', 'critical'])[(n / 4) % 4 + 1]::priority_level,
       (n % 2 = 0),
       (SELECT id FROM ticket_types ORDER BY name LIMIT 1 OFFSET (n % (SELECT count(*) FROM ticket_types))),
       CASE WHEN n % 5 = 0 THEN NULL ELSE pg_temp.fx_uuid('f4000000', n % 10 + 1) END,
       pg_temp.fx_uuid('f1000000', (n * 7) % 300 + 1),
       CASE WHEN n % 4 = 0 THEN NULL ELSE pg_temp.fx_uuid('f1000000', (n % 15 + 1) * 20) END,
       CASE n % 6
         WHEN 0 THEN NULL
         WHEN 1 THEN '{}'::jsonb
         WHEN 2 THEN jsonb_build_object('order', n, 'note', 'ünïcödé ✓', 'nested', jsonb_build_object('a', jsonb_build_array(1, 2, jsonb_build_object('b', NULL))))
         WHEN 3 THEN jsonb_build_object('big', 9007199254740993::numeric, 'neg', -0.0001, 'bool', false)
         WHEN 4 THEN jsonb_build_object('html', '<img src=x onerror=alert(1)>', 'quote', 'it''s')
         ELSE jsonb_build_object('list', to_jsonb(ARRAY['x', 'y', 'z']))
       END,
       now() - make_interval(hours => n * 9),          -- spread over ~3 years
       now() - make_interval(hours => n * 9) + make_interval(mins => n % 500)
FROM generate_series(1, 3000) n;

-- Duplicate / merge / clone chains (reference earlier fixture tickets).
UPDATE tickets SET duplicate_of_id = id - 1 WHERE id BETWEEN 900002 AND 903000 AND id % 50 = 0;
UPDATE tickets SET merged_into_id  = id - 2 WHERE id BETWEEN 900003 AND 903000 AND id % 60 = 1;
UPDATE tickets SET cloned_from_id  = id - 3 WHERE id BETWEEN 900004 AND 903000 AND id % 70 = 2;

SELECT setval('tickets_id_seq', GREATEST((SELECT max(id) FROM tickets), 903000));

-- ---------------------------------------------------------------------------
-- Posts: original post per ticket, 4 replies each, comments on some replies,
-- second-level replies to some comments, private notes, drafts, edits.
-- ---------------------------------------------------------------------------
-- Originals (kind 1).
INSERT INTO posts (id, ticket_id, author_id, post_type, body, is_private, is_original, created_at)
SELECT pg_temp.fx_uuid('f2100000', n), 900000 + n, pg_temp.fx_uuid('f1000000', (n * 7) % 300 + 1), 'post',
       CASE n % 8
         WHEN 0 THEN left(repeat('Very long body. ', 4000), 50000)              -- max length
         WHEN 1 THEN ''                                                         -- empty body
         WHEN 2 THEN E'Multi\nline\r\nbody with \t tabs and trailing spaces   \n\n'
         WHEN 3 THEN '![screenshot](https://example.com/a.png) and [link](https://example.com/?q=a&b=c)'
         WHEN 4 THEN 'Ошибка: «не удаётся сохранить» — см. лог 🧾'
         WHEN 5 THEN '<iframe src="javascript:alert(1)"></iframe>'
         WHEN 6 THEN E'```sql\nSELECT * FROM tickets WHERE title = ''x'';\n```'
         ELSE 'Original description of fixture ticket ' || n
       END,
       (n % 2 = 0), true,
       now() - make_interval(hours => n * 9)
FROM generate_series(1, 3000) n;

-- Replies (kind 2): 4 per ticket, alternating author between creator and agent.
INSERT INTO posts (id, ticket_id, author_id, post_type, body, is_private, is_draft, edited_at, created_at)
SELECT pg_temp.fx_uuid('f2200000', n * 10 + r), 900000 + n,
       CASE WHEN r % 2 = 0 OR n % 4 = 0 THEN pg_temp.fx_uuid('f1000000', (n * 7) % 300 + 1)
            ELSE pg_temp.fx_uuid('f1000000', (n % 15 + 1) * 20) END,
       'post',
       'Reply ' || r || ' on ticket ' || n || CASE WHEN r = 3 THEN ' — ответ с юникодом ✅' ELSE '' END,
       false,
       (r = 4 AND n % 9 = 0),                                    -- unpublished drafts
       CASE WHEN (n + r) % 11 = 0 THEN now() - make_interval(hours => n * 9 - r) END,
       now() - make_interval(hours => n * 9) + make_interval(mins => r * 7)
FROM generate_series(1, 3000) n, generate_series(1, 4) r;

-- Comments on replies (kind 3) and second-level replies to comments (kind 4).
INSERT INTO posts (id, ticket_id, author_id, parent_post_id, post_type, body, created_at)
SELECT pg_temp.fx_uuid('f2300000', n * 10 + r), 900000 + n, pg_temp.fx_uuid('f1000000', (n * 11) % 300 + 1),
       pg_temp.fx_uuid('f2200000', n * 10 + r), 'comment', 'Comment on reply ' || r || ' — 💬',
       now() - make_interval(hours => n * 9) + make_interval(mins => r * 7 + 1)
FROM generate_series(1, 3000) n, generate_series(1, 4) r
WHERE (n + r) % 3 = 0;

INSERT INTO posts (id, ticket_id, author_id, parent_post_id, parent_comment_id, post_type, body, created_at)
SELECT pg_temp.fx_uuid('f2400000', n * 10 + r), 900000 + n, pg_temp.fx_uuid('f1000000', (n * 13) % 300 + 1),
       pg_temp.fx_uuid('f2200000', n * 10 + r), pg_temp.fx_uuid('f2300000', n * 10 + r), 'comment',
       'Nested reply to comment', now() - make_interval(hours => n * 9) + make_interval(mins => r * 7 + 2)
FROM generate_series(1, 3000) n, generate_series(1, 4) r
WHERE (n + r) % 3 = 0 AND n % 2 = 0;

-- Private internal notes by agents (kind 5).
INSERT INTO posts (id, ticket_id, author_id, post_type, body, is_private, created_at)
SELECT pg_temp.fx_uuid('f2500000', n), 900000 + n, pg_temp.fx_uuid('f1000000', (n % 15 + 1) * 20), 'note',
       'Internal note: customer is on plan "Pro" — don''t share', true,
       now() - make_interval(hours => n * 9) + interval '1 hour'
FROM generate_series(1, 3000) n
WHERE n % 5 = 0;

-- ---------------------------------------------------------------------------
-- Attachments: on posts, orphan (uploaded, never claimed), legacy blobs.
-- ---------------------------------------------------------------------------
INSERT INTO attachments (id, post_id, uploader_id, storage_path, legacy_blob_id, original_filename, file_size, mime_type, created_at)
SELECT pg_temp.fx_uuid('f6000000', n),
       CASE WHEN n % 10 = 0 THEN NULL ELSE pg_temp.fx_uuid('f2100000', n % 3000 + 1) END,
       CASE WHEN n % 10 = 0 OR n % 3 = 0 THEN pg_temp.fx_uuid('f1000000', n % 300 + 1) END,
       CASE WHEN n % 25 = 0 THEN NULL ELSE 'fixtures/' || n || '/file-' || n END,
       CASE WHEN n % 25 = 0 THEN pg_temp.fx_uuid('f7000000', n) END,
       CASE n % 6
         WHEN 0 THEN left('very-long-name-' || repeat('a', 300), 251) || '.pdf'   -- 255 chars
         WHEN 1 THEN 'отчёт за март 2026.xlsx'
         WHEN 2 THEN 'screenshot 🖼️.png'
         WHEN 3 THEN 'no-extension'
         WHEN 4 THEN 'weird ](evil).pdf'
         ELSE 'file-' || n || '.txt'
       END,
       CASE n % 5 WHEN 0 THEN 0 WHEN 1 THEN 5368709120 ELSE n * 1024 END,   -- 0 B and 5 GiB
       (ARRAY['application/pdf', 'image/png', 'text/plain', 'application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])[n % 5 + 1],
       now() - make_interval(hours => n * 13)
FROM generate_series(1, 2000) n;

-- ---------------------------------------------------------------------------
-- Tags and followers
-- ---------------------------------------------------------------------------
INSERT INTO ticket_tags (ticket_id, tag_id)
SELECT 900000 + n, pg_temp.fx_uuid('f5000000', (n * k) % 40 + 1)
FROM generate_series(1, 3000) n, generate_series(1, 3) k
WHERE n % 4 <> 0 AND k <= n % 4
ON CONFLICT DO NOTHING;

INSERT INTO ticket_followers (ticket_id, user_id, created_at)
SELECT DISTINCT ON (t.id, u.user_id) t.id, u.user_id, t.created_at
FROM tickets t
CROSS JOIN LATERAL (VALUES (t.creator_id), (t.assigned_agent_id)) AS u(user_id)
WHERE t.id BETWEEN 900001 AND 903000 AND u.user_id IS NOT NULL AND t.id % 2 = 0;

ANALYZE;
