-- =============================================================================
-- daily-digest-send — pg_cron job that POSTs to /send-daily-digest once a day
-- so users who opted in (user_notification_preferences.daily_digest = TRUE)
-- get a single morning roll-up of their unread mentions + decision acks +
-- overdue deviations.
--
-- Pattern mirrors `ingest-recover-safety-net` (20260703000001) exactly —
-- self-guarding NOTICE if pg_cron/pg_net/Vault aren't configured, so
-- `supabase db push` never fails just because of missing infra. Operator
-- prerequisites:
--   • extensions pg_cron + pg_net enabled
--   • Vault secrets:  project_url       = https://<ref>.supabase.co
--                     service_role_key  = <the project service_role JWT>
--
-- Schedule: 13:00 UTC daily = 09:00 ET / 06:00 PT. Adjust the cron
-- expression with `cron.alter_job` if you want a different morning slot.
-- =============================================================================

DO $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE '[daily-digest] pg_cron/pg_net unavailable — configure the digest schedule manually';
    RETURN;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url'      LIMIT 1;
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL; v_key := NULL;
  END;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE '[daily-digest] Vault secrets project_url/service_role_key not set — skipping. Set them, then re-run this block.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-digest-send') THEN
    PERFORM cron.unschedule('daily-digest-send');
  END IF;

  PERFORM cron.schedule(
    'daily-digest-send',
    '0 13 * * *',
    format(
      $cmd$
        SELECT net.http_post(
          url     := %L,
          headers := jsonb_build_object('Authorization', 'Bearer ' || %L, 'Content-Type', 'application/json'),
          body    := '{}'::jsonb
        );
      $cmd$,
      v_url || '/functions/v1/send-daily-digest',
      v_key
    )
  );
  RAISE NOTICE '[daily-digest] scheduled send-daily-digest at 13:00 UTC daily';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[daily-digest] setup skipped: %', SQLERRM;
END $$;
