-- Turn imported AnswerDesk staff notes back into internal notes (private-tasks#635).
--
-- Imports made before the fix mapped AnswerDesk Posts.Type 3 (the NOTES panel,
-- staff only) to public comments, so customers could read them. This finds
-- those posts by their source id (listed by fix-notes.mjs in
-- /tmp/adimport/notes.tsv) and makes them `note` posts: agents only, shown in
-- the ticket's Internal notes tab, no parent. Only rows still imported as
-- comments or posts change, so it is safe to run again.
--
-- Run inside a transaction (import.sh fix-notes does). Prints the counts.

CREATE TEMP TABLE fix_note_ids (id UUID PRIMARY KEY) ON COMMIT DROP;
COPY fix_note_ids FROM '/tmp/adimport/notes.tsv';

CREATE TEMP TABLE fix_note_targets ON COMMIT DROP AS
SELECT p.id
FROM public.posts p
JOIN fix_note_ids f ON f.id = p.id
WHERE p.post_type <> 'note' AND NOT p.is_original;

-- Nothing in the source replies to a note, but never leave a reply pointing
-- at one: such a reply keeps its top-level parent only.
UPDATE public.posts
SET parent_comment_id = NULL
WHERE parent_comment_id IN (SELECT id FROM fix_note_targets);

UPDATE public.posts
SET post_type = 'note', parent_post_id = NULL, parent_comment_id = NULL, is_private = false
WHERE id IN (SELECT id FROM fix_note_targets);

SELECT 'staff notes listed: ' || (SELECT count(*) FROM fix_note_ids)
  || ', converted to internal notes now: ' || (SELECT count(*) FROM fix_note_targets)
  || ', imported notes in total: '
  || (SELECT count(*) FROM public.posts p JOIN fix_note_ids f ON f.id = p.id WHERE p.post_type = 'note');
