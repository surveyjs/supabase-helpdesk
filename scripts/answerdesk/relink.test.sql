-- Regression test for adimport.relink_body / ticket_friendly (relink.sql).
-- Run by `import.sh test-relink`, which first copies relink.sql and a SYNTHETIC
-- ticket_friendly.tsv into /tmp/adimport of the DB container. Everything below
-- is invented data; the whole run is one transaction that is rolled back, so
-- the database is left unchanged. Any mismatch raises an exception.
--
-- Fixture tickets (invented):
--   FriendlyId 4502 -> imported ticket 9000000001 (10-digit id), slug alpha-slug
--   FriendlyId 4503 -> source ticket that is NOT imported (legacy text)
--   FriendlyId 4504 -> TWO source tickets (duplicate FriendlyId); the lowest
--                      legacy_id (...0004 -> ticket 9000000002, slug dup-low) must win
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL session_replication_role = replica; -- fixture tickets skip FKs/triggers

CREATE SCHEMA adimport; -- fails if an import already exists here: never test on real data
CREATE TABLE adimport.ticket_map (legacy_id UUID PRIMARY KEY, ticket_id BIGINT NOT NULL UNIQUE);

INSERT INTO public.tickets (id, title, slug, type_id, creator_id) VALUES
  (9000000001, 'Fixture alpha', 'alpha-slug', gen_random_uuid(), gen_random_uuid()),
  (9000000002, 'Fixture dup low', 'dup-low', gen_random_uuid(), gen_random_uuid()),
  (9000000003, 'Fixture dup high', 'dup-high', gen_random_uuid(), gen_random_uuid());
INSERT INTO adimport.ticket_map VALUES
  ('00000000-0000-4000-8000-000000000001', 9000000001),
  ('00000000-0000-4000-8000-000000000004', 9000000002),
  ('00000000-0000-4000-8000-000000000005', 9000000003);

\i /tmp/adimport/relink.sql

CREATE FUNCTION pg_temp.chk(name TEXT, input TEXT, expected TEXT,
  exp_rl INT DEFAULT NULL, exp_rg INT DEFAULT NULL, exp_ul INT DEFAULT NULL, exp_uf INT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE r RECORD; again TEXT;
BEGIN
  SELECT * INTO r FROM adimport.relink_body(input);
  IF r.new_body IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'relink test "%": expected % but got %', name, expected, r.new_body;
  END IF;
  IF (exp_rl IS NOT NULL AND r.refs_linked <> exp_rl) OR (exp_rg IS NOT NULL AND r.refs_legacy <> exp_rg)
     OR (exp_ul IS NOT NULL AND r.urls_linked <> exp_ul) OR (exp_uf IS NOT NULL AND r.urls_left <> exp_uf) THEN
    RAISE EXCEPTION 'relink test "%": counts linked/legacy/urls_linked/urls_left were %/%/%/%, expected %/%/%/%',
      name, r.refs_linked, r.refs_legacy, r.urls_linked, r.urls_left, exp_rl, exp_rg, exp_ul, exp_uf;
  END IF;
  SELECT new_body INTO again FROM adimport.relink_body(r.new_body);
  IF again IS DISTINCT FROM r.new_body THEN
    RAISE EXCEPTION 'relink test "%": second run is not idempotent: % -> %', name, r.new_body, again;
  END IF;
END $f$;

DO $t$
DECLARE
  nl CONSTANT TEXT := chr(10);
  -- markers: 4502 imported, 4503 not imported, 4504 duplicate FriendlyId
  m1  CONSTANT TEXT := $m${'FriendlyId':'T4502','HashCode':'','CheckAnswerDesk':'11111111-aaaa'}$m$;
  m1b CONSTANT TEXT := $m${'FriendlyId':'4502','CheckAnswerDesk':'11111111-aaaa'}$m$;
  m3  CONSTANT TEXT := $m${'FriendlyId':'t4503','HashCode':'','CheckAnswerDesk':'33333333-cccc'}$m$;
  m4  CONSTANT TEXT := $m${'FriendlyId':'T4504','CheckAnswerDesk':'44444444-dddd'}$m$;
  mbig CONSTANT TEXT := $m${'FriendlyId':'T1234567890','CheckAnswerDesk':'55555555-eeee'}$m$;
  u1  CONSTANT TEXT := '/tickets/9000000001/alpha-slug';
  ad  CONSTANT TEXT := 'https://fixture.answerdesk.io/ticket/details/';
  wanted UUID;
BEGIN
  -- B41: duplicate FriendlyId resolves to the lowest legacy_id, whatever the file order
  SELECT legacy_id INTO wanted FROM adimport.ticket_friendly WHERE friendly_no = 4504;
  IF wanted IS DISTINCT FROM '00000000-0000-4000-8000-000000000004'::uuid THEN
    RAISE EXCEPTION 'duplicate FriendlyId 4504 mapped to % instead of the lowest legacy_id', wanted;
  END IF;
  IF (SELECT count(*) FROM adimport.ticket_friendly) <> 3 THEN
    RAISE EXCEPTION 'ticket_friendly should hold 3 rows (4502, 4503, 4504)';
  END IF;
  PERFORM pg_temp.chk('duplicate FriendlyId -> lowest legacy_id', 'see ' || m4,
    'see [T4504](/tickets/9000000002/dup-low)', 1, 0, 0, 0);

  -- body without any reference is returned as is
  PERFORM pg_temp.chk('no reference', 'plain text', 'plain text', 0, 0, 0, 0);

  -- a. reference definition
  PERFORM pg_temp.chk('a imported', '[ref]: ' || m1, '[ref]: ' || u1, 1, 0, 0, 0);
  PERFORM pg_temp.chk('a legacy', '[ref]: <' || m3 || '>', '\[ref\]: T4503 (legacy ticket)', 0, 1, 0, 0);

  -- b. marker as link text (then c handles the target)
  PERFORM pg_temp.chk('b imported', '[' || m1 || '](' || m1 || ')', '[T4502](' || u1 || ')', 1, 0, 0, 0);
  PERFORM pg_temp.chk('b legacy', '[ ' || m3 || ' ](' || m3 || ')', 'T4503 (legacy ticket)', 0, 1, 0, 0);

  -- c. labelled link with a marker target; marker without T prefix / HashCode
  PERFORM pg_temp.chk('c imported', 'see [the other](' || m1 || ') ok', 'see [the other](' || u1 || ') ok', 1, 0, 0, 0);
  PERFORM pg_temp.chk('c no prefix', '[x](' || m1b || ')', '[x](' || u1 || ')', 1, 0, 0, 0);
  PERFORM pg_temp.chk('c legacy labelled', '[old one](' || m3 || ')', 'old one (legacy ticket T4503)', 0, 1, 0, 0);
  PERFORM pg_temp.chk('c legacy empty label', '[](' || m3 || ')', 'T4503 (legacy ticket)', 0, 1, 0, 0);

  -- d. label containing a newline (c does not match it)
  PERFORM pg_temp.chk('d imported, newline in label', '[line one' || nl || 'line two](' || m1 || ')',
    '[line one' || nl || 'line two](' || u1 || ')', 1, 0, 0, 0);
  PERFORM pg_temp.chk('d legacy, newline in label', '[line one' || nl || 'line two](' || m3 || ')',
    '[line one' || nl || 'line two] (legacy ticket T4503)', 0, 1, 0, 0);

  -- e. bare marker, also across lines and with several in one body
  PERFORM pg_temp.chk('e imported', 'ticket ' || m1 || ' here', 'ticket [T4502](' || u1 || ') here', 1, 0, 0, 0);
  PERFORM pg_temp.chk('e legacy', 'ticket ' || m3 || ' here', 'ticket T4503 (legacy ticket) here', 0, 1, 0, 0);
  PERFORM pg_temp.chk('e mixed lines', m1 || nl || m3 || nl || m1,
    '[T4502](' || u1 || ')' || nl || 'T4503 (legacy ticket)' || nl || '[T4502](' || u1 || ')', 2, 1, 0, 0);

  -- f/g. answerdesk.io URL as link text and as target (case-insensitive), reference definition
  PERFORM pg_temp.chk('f+g url text and target', '[' || ad || 't4502](' || ad || 't4502/some-slug)', '[T4502](' || u1 || ')', 0, 0, 1, 0);
  PERFORM pg_temp.chk('g target, upper case', '[text](' || ad || 'T4502/Some-Slug)', '[text](' || u1 || ')', 0, 0, 1, 0);
  PERFORM pg_temp.chk('g reference definition', '[r]: ' || ad || 't4502', '[r]: ' || u1, 0, 0, 1, 0);

  -- h. bare URL and <autolink>; unknown ticket URL stays and is counted
  PERFORM pg_temp.chk('h bare url', 'see ' || ad || 't4502/slug.', 'see [T4502](' || u1 || ').', 0, 0, 1, 0);
  PERFORM pg_temp.chk('h autolink', 'see <' || ad || 't4502>', 'see [T4502](' || u1 || ')', 0, 0, 1, 0);
  PERFORM pg_temp.chk('h url of a ticket not imported', 'see ' || ad || 't4503', 'see ' || ad || 't4503', 0, 0, 0, 1);
  PERFORM pg_temp.chk('other answerdesk.io url untouched', 'see https://fixture.answerdesk.io/about',
    'see https://fixture.answerdesk.io/about', 0, 0, 0, 0);

  -- whole-table path used by `import.sh relink`: relink_ticket_refs() rewrites imported tickets' posts
  INSERT INTO public.posts (id, ticket_id, author_id, body) VALUES
    ('00000000-0000-4000-9000-000000000001', 9000000001, gen_random_uuid(), 'refs ' || m1 || ' and ' || m3),
    ('00000000-0000-4000-9000-000000000002', 9000000001, gen_random_uuid(), 'no references here');
  IF adimport.relink_ticket_refs() <> 1 THEN RAISE EXCEPTION 'relink_ticket_refs should change exactly 1 post'; END IF;
  IF (SELECT body FROM public.posts WHERE id = '00000000-0000-4000-9000-000000000001')
     IS DISTINCT FROM 'refs [T4502](' || u1 || ') and T4503 (legacy ticket)' THEN
    RAISE EXCEPTION 'relink_ticket_refs wrote an unexpected body';
  END IF;
  IF (SELECT body FROM public.posts WHERE id = '00000000-0000-4000-9000-000000000002') <> 'no references here' THEN
    RAISE EXCEPTION 'relink_ticket_refs changed a post without references';
  END IF;
  IF adimport.relink_ticket_refs() <> 0 THEN RAISE EXCEPTION 'relink_ticket_refs is not idempotent'; END IF;

  -- 10-digit FriendlyId is not a marker (at most 9 digits): left alone
  PERFORM pg_temp.chk('10-digit FriendlyId untouched', 'x ' || mbig, 'x ' || mbig, 0, 0, 0, 0);
END $t$;

ROLLBACK;

