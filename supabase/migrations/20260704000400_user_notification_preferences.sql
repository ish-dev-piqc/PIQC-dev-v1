-- =============================================================================
-- user_notification_preferences — per-user toggles for email notifications.
--
-- One row per user (PK on user_id). Default behavior is "all off" until
-- the user opts in. Each pref column maps to a downstream send path that
-- the follow-up PR will wire to an edge function:
--
--   notify_mentions_email   → on chat_mentions INSERT for me, email me
--   notify_decisions_email  → on chat_decision_acks INSERT for me, email me
--   daily_digest            → 9am-local roundup of unread items
--
-- RLS: self-only on all four CRUD verbs. Admins don't get to peek at
-- other users' prefs; this is private settings, not shared state.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id                 UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notify_mentions_email   BOOLEAN      NOT NULL DEFAULT FALSE,
  notify_decisions_email  BOOLEAN      NOT NULL DEFAULT FALSE,
  daily_digest            BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notification_prefs_self_select ON public.user_notification_preferences;
CREATE POLICY user_notification_prefs_self_select
  ON public.user_notification_preferences
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_notification_prefs_self_insert ON public.user_notification_preferences;
CREATE POLICY user_notification_prefs_self_insert
  ON public.user_notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notification_prefs_self_update ON public.user_notification_preferences;
CREATE POLICY user_notification_prefs_self_update
  ON public.user_notification_preferences
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notification_prefs_self_delete ON public.user_notification_preferences;
CREATE POLICY user_notification_prefs_self_delete
  ON public.user_notification_preferences
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Touch updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION public.user_notification_prefs_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_notification_prefs_updated_at ON public.user_notification_preferences;
CREATE TRIGGER user_notification_prefs_updated_at
  BEFORE UPDATE ON public.user_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.user_notification_prefs_touch_updated_at();
