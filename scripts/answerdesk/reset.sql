-- Undo the AnswerDesk import on a DEV instance: deletes every imported ticket
-- (posts, attachments rows, tags, followers, CSAT, activity cascade) and every
-- account the import created, then clears the id maps. Accounts that existed
-- before the import (linked by id / SSO subject / email) are kept, but the SSO
-- identities the import added to them are removed. Categories, tags, ticket
-- types and custom fields are kept (they are reused by name on the next run).
-- Storage blobs under attachments/migrated/ are kept too, so a re-import does
-- not re-upload them; see README for removing them.

\set ON_ERROR_STOP on
SET client_min_messages = warning;
BEGIN;

DO $$ BEGIN
  IF to_regclass('adimport.ticket_map') IS NULL THEN RAISE EXCEPTION 'Nothing to reset: schema adimport not found'; END IF;
END $$;

-- References from non-imported tickets / KB articles to imported tickets.
UPDATE public.tickets SET duplicate_of_id = NULL WHERE duplicate_of_id IN (SELECT ticket_id FROM adimport.ticket_map);
UPDATE public.tickets SET merged_into_id  = NULL WHERE merged_into_id  IN (SELECT ticket_id FROM adimport.ticket_map);
UPDATE public.tickets SET cloned_from_id  = NULL WHERE cloned_from_id  IN (SELECT ticket_id FROM adimport.ticket_map);
DELETE FROM public.tickets WHERE id IN (SELECT ticket_id FROM adimport.ticket_map);

-- SSO identities added to pre-existing accounts.
DELETE FROM auth.identities WHERE id IN (SELECT identity_id FROM adimport.identity_added);

-- Accounts created by the import. Anything they authored outside imported
-- tickets (e.g. replies typed while testing) blocks this: delete it first.
DELETE FROM public.profiles WHERE id IN (SELECT user_id FROM adimport.user_map WHERE created_by_import);
DELETE FROM auth.users      WHERE id IN (SELECT user_id FROM adimport.user_map WHERE created_by_import);

DROP SCHEMA adimport CASCADE;
COMMIT;

SELECT 'reset done' AS status;
