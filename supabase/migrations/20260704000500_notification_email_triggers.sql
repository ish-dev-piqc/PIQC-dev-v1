-- =============================================================================
-- Notification email triggers — fire on chat_mentions / chat_decision_acks
-- INSERT and POST to the send-notification-email edge function via pg_net.
--
-- Self-guarding: NO-OPS (with a NOTICE) if pg_net or the required Vault
-- secrets aren't configured, so `supabase db push` never fails because of
-- it. Required Vault entries:
--   project_url       = https://<ref>.supabase.co
--   service_role_key  = <the project service_role JWT>
--
-- Each trigger:
--   1. Reads the recipient's user_notification_preferences row.
--   2. Skips when the relevant boolean is false (defensive — the edge
--      function double-checks too).
--   3. Calls net.http_post with a small JSON payload identifying the
--      event. Async; pg_net returns immediately and processes in the
--      background.
-- =============================================================================

DO $$
DECLARE
  v_url      text;
  v_key      text;
  v_endpoint text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE '[notif-email] pg_net unavailable — skipping trigger install';
    RETURN;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url'     LIMIT 1;
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL; v_key := NULL;
  END;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE '[notif-email] Vault secrets project_url/service_role_key not set — skipping';
    RETURN;
  END IF;

  v_endpoint := v_url || '/functions/v1/send-notification-email';

  -- -------------------------------------------------------------------------
  -- Trigger function — mentions. SECURITY DEFINER so it can read
  -- user_notification_preferences (which has self-only RLS).
  -- -------------------------------------------------------------------------
  EXECUTE format($body$
    CREATE OR REPLACE FUNCTION public.fn_notify_mention_email()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $f$
    DECLARE
      v_enabled BOOLEAN;
    BEGIN
      SELECT notify_mentions_email INTO v_enabled
      FROM user_notification_preferences
      WHERE user_id = NEW.mentioned_user_id;
      IF v_enabled IS DISTINCT FROM TRUE THEN
        RETURN NEW;
      END IF;
      PERFORM net.http_post(
        url     := %L,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'Content-Type', 'application/json'
        ),
        body    := jsonb_build_object(
          'type', 'mention',
          'user_id', NEW.mentioned_user_id,
          'context', jsonb_build_object(
            'mention_id', NEW.id,
            'message_id', COALESCE(NEW.org_message_id, NEW.protocol_message_id),
            'org_id', NEW.org_id,
            'protocol_id', NEW.protocol_id,
            'mentioned_by_user_id', NEW.mentioned_by_user_id
          )
        )
      );
      RETURN NEW;
    END;
    $f$;
  $body$, v_endpoint, v_key);

  DROP TRIGGER IF EXISTS chat_mentions_email ON public.chat_mentions;
  CREATE TRIGGER chat_mentions_email
    AFTER INSERT ON public.chat_mentions
    FOR EACH ROW EXECUTE FUNCTION public.fn_notify_mention_email();

  -- -------------------------------------------------------------------------
  -- Trigger function — decision acks.
  -- -------------------------------------------------------------------------
  EXECUTE format($body$
    CREATE OR REPLACE FUNCTION public.fn_notify_decision_ack_email()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $f$
    DECLARE
      v_enabled BOOLEAN;
      v_title TEXT;
    BEGIN
      SELECT notify_decisions_email INTO v_enabled
      FROM user_notification_preferences
      WHERE user_id = NEW.required_user_id;
      IF v_enabled IS DISTINCT FROM TRUE THEN
        RETURN NEW;
      END IF;
      SELECT title INTO v_title FROM chat_decisions WHERE id = NEW.decision_id;
      PERFORM net.http_post(
        url     := %L,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'Content-Type', 'application/json'
        ),
        body    := jsonb_build_object(
          'type', 'decision_ack',
          'user_id', NEW.required_user_id,
          'context', jsonb_build_object(
            'decision_id', NEW.decision_id,
            'decision_title', COALESCE(v_title, '(untitled)')
          )
        )
      );
      RETURN NEW;
    END;
    $f$;
  $body$, v_endpoint, v_key);

  DROP TRIGGER IF EXISTS chat_decision_acks_email ON public.chat_decision_acks;
  CREATE TRIGGER chat_decision_acks_email
    AFTER INSERT ON public.chat_decision_acks
    FOR EACH ROW EXECUTE FUNCTION public.fn_notify_decision_ack_email();

  RAISE NOTICE '[notif-email] installed mention + decision-ack email triggers';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[notif-email] setup skipped: %', SQLERRM;
END $$;
