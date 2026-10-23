-- ============================================================
-- 004 — SLA checks move from pg_cron to the image's scheduler
-- ============================================================
-- 001 schedules `check-sla-timers` (only where pg_cron exists) to POST
-- /api/cron/sla using app.settings.base_url / app.settings.cron_secret, which
-- nothing sets. The image's `scheduler` command now calls the cron endpoints in
-- every deployment mode. Re-runnable: unschedules only an existing job. The
-- nested IF keeps cron.job unparsed where pg_cron is absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-sla-timers') THEN
      PERFORM cron.unschedule('check-sla-timers');
    END IF;
  END IF;
END
$$;
