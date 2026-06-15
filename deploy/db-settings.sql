-- Per-instance database settings required AFTER migrations are applied.
--
-- The pg_cron jobs (see supabase/migrations/011_sla.sql) call the app over HTTP
-- with pg_net, reading these settings:
--   current_setting('app.settings.base_url')   -> e.g. https://helpdesk.surveyjs.io
--   current_setting('app.settings.cron_secret') -> must equal the app's CRON_SECRET
--
-- Run once per instance against its postgres DB, substituting the real values:
--
--   docker compose -p helpdesk-internal exec -T db \
--     psql -U postgres -d postgres -v base_url='https://helpdesk.surveyjs.io' \
--                                  -v cron_secret='<CRON_SECRET>' \
--          -f - < deploy/db-settings.sql
--
-- (psql :var substitution is used so secrets are not hard-coded in this file.)

ALTER DATABASE postgres SET app.settings.base_url   = :'base_url';
ALTER DATABASE postgres SET app.settings.cron_secret = :'cron_secret';

-- Settings apply to new sessions; bounce pg_cron's background workers so the
-- scheduled jobs pick them up immediately (otherwise they apply on next start).
SELECT pg_reload_conf();

-- Sanity check (new psql session needed to observe the new values):
--   SHOW app.settings.base_url;
--   SELECT jobname, schedule FROM cron.job ORDER BY jobname;
