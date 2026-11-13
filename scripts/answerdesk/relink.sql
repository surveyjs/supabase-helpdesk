-- Cross-ticket references in imported posts. Included by load.sql (inside its
-- transaction) and by `import.sh relink`; both copy this file and
-- ticket_friendly.tsv into the DB container at /tmp/adimport first.
--
-- AnswerDesk wrote a link to another ticket as a marker
--   {'FriendlyId':'T4502','HashCode':'','CheckAnswerDesk':'<guid>'}
-- (HashCode optional, t/T prefix), used as a link target, as link text, in a
-- reference definition or bare, and some posts link to
-- https://<host>.answerdesk.io/ticket/details/t4502[/<slug>].
-- adimport.relink_ticket_refs() rewrites them in posts of imported tickets to
-- the app's /tickets/<id>/<slug> links; references to tickets that are not
-- imported become plain "legacy ticket" text (other answerdesk.io URLs stay).
-- Idempotent: a second call changes nothing.

-- FriendlyId number -> source Tickets.Id, for ALL source tickets.
CREATE TABLE IF NOT EXISTS adimport.ticket_friendly (friendly_no INT PRIMARY KEY, legacy_id UUID NOT NULL);

DROP TABLE IF EXISTS adimport.s_ticket_friendly;
CREATE TABLE adimport.s_ticket_friendly (friendly_no INT, legacy_id UUID);
COPY adimport.s_ticket_friendly FROM '/tmp/adimport/ticket_friendly.tsv';
INSERT INTO adimport.ticket_friendly (friendly_no, legacy_id)
-- A FriendlyId shared by several source tickets maps to the lowest legacy_id (deterministic).
SELECT DISTINCT ON (friendly_no) friendly_no, legacy_id FROM adimport.s_ticket_friendly ORDER BY friendly_no, legacy_id
ON CONFLICT (friendly_no) DO UPDATE SET legacy_id = EXCLUDED.legacy_id;
DROP TABLE adimport.s_ticket_friendly;

-- '/tickets/<id>/<slug>' of the imported ticket with this FriendlyId number, or NULL.
CREATE OR REPLACE FUNCTION adimport.ticket_ref_url(n TEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT '/tickets/' || t.id || '/' || t.slug
  FROM adimport.ticket_friendly f
  JOIN adimport.ticket_map m ON m.legacy_id = f.legacy_id
  JOIN public.tickets t ON t.id = m.ticket_id
  WHERE f.friendly_no = n::int
$$;

-- Rewrites one body. Each rule replaces every occurrence of a matched string
-- (the replacement depends only on that string), longest matches first.
CREATE OR REPLACE FUNCTION adimport.relink_body(
  body TEXT,
  OUT new_body TEXT, OUT refs_linked INT, OUT refs_legacy INT, OUT urls_linked INT, OUT urls_left INT
) LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  -- marker; group = FriendlyId number
  mk CONSTANT TEXT := '\{''FriendlyId'':''[tT]?([0-9]{1,9})''[^{}\n]*\}';
  -- answerdesk.io ticket page; group = FriendlyId number (matched case-insensitively)
  ad CONSTANT TEXT := 'https?://[a-z0-9.-]*answerdesk\.io/ticket/details/t([0-9]{1,9})(?:/[a-z0-9_%~-]*)?';
  m TEXT[];
  url TEXT;
  label TEXT;
BEGIN
  new_body := body; refs_linked := 0; refs_legacy := 0; urls_linked := 0; urls_left := 0;
  IF body NOT LIKE '%FriendlyId%' AND body !~* 'answerdesk\.io/ticket/details/' THEN RETURN; END IF;

  -- a. Reference definition "[ref]: {marker}".
  FOR m IN SELECT r FROM regexp_matches(new_body, '(\[([^][\n]*)\]:[ \t]*<?' || mk || '>?)', 'g') r ORDER BY length(r[1]) DESC LOOP
    url := adimport.ticket_ref_url(m[3]);
    IF url IS NOT NULL THEN
      new_body := replace(new_body, m[1], '[' || m[2] || ']: ' || url); refs_linked := refs_linked + 1;
    ELSE -- escaped, so it shows as text instead of defining a link to nowhere
      new_body := replace(new_body, m[1], '\[' || m[2] || '\]: T' || m[3] || ' (legacy ticket)'); refs_legacy := refs_legacy + 1;
    END IF;
  END LOOP;

  -- b. Marker as link text "[{marker}](" -> "[T123](" (the target is handled below).
  FOR m IN SELECT r FROM regexp_matches(new_body, '(\[\s*' || mk || '\s*\]\()', 'g') r ORDER BY length(r[1]) DESC LOOP
    new_body := replace(new_body, m[1], '[T' || m[2] || '](');
  END LOOP;

  -- c. Link with a marker target "[label]({marker})".
  FOR m IN SELECT r FROM regexp_matches(new_body, '(\[([^][\n]*)\]\(\s*<?' || mk || '>?\s*\))', 'g') r ORDER BY length(r[1]) DESC LOOP
    url := adimport.ticket_ref_url(m[3]);
    label := btrim(m[2]);
    IF url IS NOT NULL THEN
      new_body := replace(new_body, m[1], '[' || m[2] || '](' || url || ')'); refs_linked := refs_linked + 1;
    ELSIF label = '' OR upper(label) = 'T' || m[3] THEN
      new_body := replace(new_body, m[1], 'T' || m[3] || ' (legacy ticket)'); refs_legacy := refs_legacy + 1;
    ELSE
      new_body := replace(new_body, m[1], m[2] || ' (legacy ticket T' || m[3] || ')'); refs_legacy := refs_legacy + 1;
    END IF;
  END LOOP;

  -- d. Marker target whose link text did not match c (brackets/newlines in it): "]({marker})".
  FOR m IN SELECT r FROM regexp_matches(new_body, '(\]\(\s*<?' || mk || '>?\s*\))', 'g') r ORDER BY length(r[1]) DESC LOOP
    url := adimport.ticket_ref_url(m[2]);
    IF url IS NOT NULL THEN
      new_body := replace(new_body, m[1], '](' || url || ')'); refs_linked := refs_linked + 1;
    ELSE
      new_body := replace(new_body, m[1], '] (legacy ticket T' || m[2] || ')'); refs_legacy := refs_legacy + 1;
    END IF;
  END LOOP;

  -- e. Any remaining (bare) marker.
  FOR m IN SELECT r FROM regexp_matches(new_body, '(' || mk || ')', 'g') r ORDER BY length(r[1]) DESC LOOP
    url := adimport.ticket_ref_url(m[2]);
    IF url IS NOT NULL THEN
      new_body := replace(new_body, m[1], '[T' || m[2] || '](' || url || ')'); refs_linked := refs_linked + 1;
    ELSE
      new_body := replace(new_body, m[1], 'T' || m[2] || ' (legacy ticket)'); refs_legacy := refs_legacy + 1;
    END IF;
  END LOOP;

  IF new_body !~* 'answerdesk\.io/ticket/details/' THEN RETURN; END IF;

  -- f. answerdesk.io ticket URL as link text: "[https://….answerdesk.io/ticket/details/t123](" -> "[T123](".
  FOR m IN SELECT r FROM regexp_matches(new_body, '(\[\s*' || ad || '\s*\]\()', 'gi') r ORDER BY length(r[1]) DESC LOOP
    IF adimport.ticket_ref_url(m[2]) IS NOT NULL THEN
      new_body := replace(new_body, m[1], '[T' || m[2] || '](');
    END IF;
  END LOOP;

  -- g. … as link target or reference definition: keep the link, swap the URL.
  FOR m IN SELECT r FROM regexp_matches(new_body, '((\]\(\s*<?|\]:[ \t]*<?)' || ad || ')', 'gi') r ORDER BY length(r[1]) DESC LOOP
    url := adimport.ticket_ref_url(m[3]);
    IF url IS NOT NULL THEN
      new_body := replace(new_body, m[1], m[2] || url); urls_linked := urls_linked + 1;
    END IF;
  END LOOP;

  -- h. … anywhere else (bare or <autolink>): becomes a "[T123](…)" link.
  FOR m IN SELECT r FROM regexp_matches(new_body, '(<' || ad || '>|' || ad || ')', 'gi') r ORDER BY length(r[1]) DESC LOOP
    url := adimport.ticket_ref_url(coalesce(m[2], m[3]));
    IF url IS NOT NULL THEN
      new_body := replace(new_body, m[1], '[T' || coalesce(m[2], m[3]) || '](' || url || ')'); urls_linked := urls_linked + 1;
    END IF;
  END LOOP;
  SELECT count(*) INTO urls_left FROM regexp_matches(new_body, ad, 'gi');
END
$fn$;

-- Rewrites the posts of imported tickets; returns the number of posts changed.
-- Tickets keep their updated_at (the search-vector trigger would bump it).
CREATE OR REPLACE FUNCTION adimport.relink_ticket_refs() RETURNS INT
LANGUAGE plpgsql AS $fn$
DECLARE
  n INT;
  s RECORD;
  prev_role TEXT := current_setting('session_replication_role');
BEGIN
  DROP TABLE IF EXISTS pg_temp.relink_posts, pg_temp.relink_tickets;
  CREATE TEMP TABLE relink_posts ON COMMIT DROP AS
  SELECT p.id, p.ticket_id, r.*, r.new_body IS DISTINCT FROM p.body AS changed
  FROM public.posts p
  JOIN adimport.ticket_map tm ON tm.ticket_id = p.ticket_id
  CROSS JOIN LATERAL adimport.relink_body(p.body) r
  WHERE p.body LIKE '%FriendlyId%' OR p.body ~* 'answerdesk\.io/ticket/details/';

  CREATE TEMP TABLE relink_tickets ON COMMIT DROP AS
  SELECT t.id, t.updated_at FROM public.tickets t WHERE t.id IN (SELECT ticket_id FROM relink_posts WHERE changed);

  UPDATE public.posts p SET body = r.new_body FROM relink_posts r WHERE p.id = r.id AND r.changed;
  GET DIAGNOSTICS n = ROW_COUNT;

  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.tickets t SET updated_at = k.updated_at FROM relink_tickets k
  WHERE t.id = k.id AND t.updated_at IS DISTINCT FROM k.updated_at;
  PERFORM set_config('session_replication_role', prev_role, true);

  SELECT coalesce(sum(refs_linked), 0) AS rl, coalesce(sum(refs_legacy), 0) AS rg,
         coalesce(sum(urls_linked), 0) AS ul, coalesce(sum(urls_left), 0) AS uf
  INTO s FROM relink_posts;
  RAISE NOTICE 'ticket refs: % linked, % legacy text; answerdesk.io ticket URLs: % linked, % left; posts changed: %',
    s.rl, s.rg, s.ul, s.uf, n;
  RETURN n;
END
$fn$;
