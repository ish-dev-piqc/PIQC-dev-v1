-- =============================================================================
-- Visit Prep / ingest — pg_cron safety net for the long-PDF reliability fix
-- (workstream D). Every 5 minutes, invoke /ingest-recover in service-role
-- (cron) mode so any document whose Reducto job completed but whose webhook
-- was missed gets finalized server-side — independent of any browser.
--
-- Self-guarding: this block NO-OPS (with a NOTICE) if pg_cron/pg_net or the
-- required Vault secrets aren't configured, so `supabase db push` never fails
-- because of it. Infra prerequisites (set once, then re-run this block):
--   • extensions pg_cron + pg_net enabled
--   • Vault secrets:  project_url        = https://<ref>.supabase.co
--                     service_role_key   = <the project service_role JWT>
-- =============================================================================

DO $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE '[recover-cron] pg_cron/pg_net unavailable — configure the recover schedule manually';
    RETURN;
  END IF;

  -- Read the project URL + service key from Vault (never hard-code the key).
  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url'      LIMIT 1;
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL; v_key := NULL;
  END;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE '[recover-cron] Vault secrets project_url/service_role_key not set — skipping. Set them, then re-run this block.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ingest-recover-safety-net') THEN
    PERFORM cron.unschedule('ingest-recover-safety-net');
  END IF;

  PERFORM cron.schedule(
    'ingest-recover-safety-net',
    '*/5 * * * *',
    format(
      $cmd$
        SELECT net.http_post(
          url     := %L,
          headers := jsonb_build_object('Authorization', 'Bearer ' || %L, 'Content-Type', 'application/json'),
          body    := '{}'::jsonb
        );
      $cmd$,
      v_url || '/functions/v1/ingest-recover',
      v_key
    )
  );
  RAISE NOTICE '[recover-cron] scheduled ingest-recover every 5 minutes';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[recover-cron] setup skipped: %', SQLERRM;
END $$;
