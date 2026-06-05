-- =============================================================================
-- Chat polish v2 — edit, soft-delete, reactions.
--
--   1. Add edited_at + deleted_at columns to org_messages + protocol_messages.
--   2. Loosen UPDATE policies so authors can edit / soft-delete their own
--      rows, and org admins can soft-delete anyone's.
--   3. New chat_reactions table mirroring chat_attachments' xor pattern.
--
-- Soft delete is non-destructive: body + attachments stay in the DB. The UI
-- treats deleted_at IS NOT NULL as the "render placeholder, hide
-- attachments + reactions" signal. Hard delete remains available via the
-- existing DELETE policies if a true purge is needed.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. New columns on the two message tables.
-- ---------------------------------------------------------------------------

ALTER TABLE public.org_messages
  ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.protocol_messages
  ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;


-- ---------------------------------------------------------------------------
-- 2. UPDATE policies.
--
-- Authors can update their own rows. Org admins can update any row in their
-- org (used for soft-delete moderation; admins shouldn't be rewriting other
-- people's bodies, but enforcing column-level which-cols-can-be-touched is
-- noisier than the value it adds — admin abuse is moderated socially).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS org_messages_author_update ON public.org_messages;
CREATE POLICY org_messages_author_update
  ON public.org_messages
  FOR UPDATE
  TO authenticated
  USING (author_user_id = auth.uid())
  WITH CHECK (author_user_id = auth.uid());

DROP POLICY IF EXISTS org_messages_admin_update ON public.org_messages;
CREATE POLICY org_messages_admin_update
  ON public.org_messages
  FOR UPDATE
  TO authenticated
  USING (org_id IN (SELECT public.current_user_admin_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_admin_org_ids()));

DROP POLICY IF EXISTS protocol_messages_author_update ON public.protocol_messages;
CREATE POLICY protocol_messages_author_update
  ON public.protocol_messages
  FOR UPDATE
  TO authenticated
  USING (author_user_id = auth.uid())
  WITH CHECK (author_user_id = auth.uid());

-- Protocol-level admin gating uses the org that owns the protocol via
-- protocol_owner_org_id (added in 20260704000000_org_events_table_and_triggers.sql).
DROP POLICY IF EXISTS protocol_messages_admin_update ON public.protocol_messages;
CREATE POLICY protocol_messages_admin_update
  ON public.protocol_messages
  FOR UPDATE
  TO authenticated
  USING (
    public.protocol_owner_org_id(protocol_id)
      IN (SELECT public.current_user_admin_org_ids())
  )
  WITH CHECK (
    public.protocol_owner_org_id(protocol_id)
      IN (SELECT public.current_user_admin_org_ids())
  );


-- ---------------------------------------------------------------------------
-- 3. chat_reactions — one row per (message, user, emoji).
--
-- xor pattern matches chat_attachments / chat_mentions: exactly one of the
-- two message FK columns is set, with the matching channel-ref denormalized
-- in alongside so RLS doesn't need a join to check visibility.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.chat_reactions (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_message_id       UUID         REFERENCES public.org_messages(id)      ON DELETE CASCADE,
  protocol_message_id  UUID         REFERENCES public.protocol_messages(id) ON DELETE CASCADE,
  org_id               UUID         REFERENCES public.orgs(id)              ON DELETE CASCADE,
  protocol_id          UUID         REFERENCES public.protocols(id)         ON DELETE CASCADE,
  user_id              UUID         NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,
  emoji                TEXT         NOT NULL CHECK (length(emoji) BETWEEN 1 AND 16),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chat_reactions_channel_xor CHECK (
    (org_message_id IS NOT NULL AND protocol_message_id IS NULL
      AND org_id IS NOT NULL AND protocol_id IS NULL)
    OR
    (org_message_id IS NULL AND protocol_message_id IS NOT NULL
      AND org_id IS NULL AND protocol_id IS NOT NULL)
  ),

  -- A user can react with the same emoji at most once per message.
  -- Two unique constraints because one half is always NULL per the xor.
  UNIQUE (org_message_id, user_id, emoji),
  UNIQUE (protocol_message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS chat_reactions_org_message_id_idx
  ON public.chat_reactions (org_message_id) WHERE org_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_reactions_protocol_message_id_idx
  ON public.chat_reactions (protocol_message_id) WHERE protocol_message_id IS NOT NULL;

ALTER TABLE public.chat_reactions ENABLE ROW LEVEL SECURITY;

-- SELECT: anyone who can see the parent channel (same gating as messages).
DROP POLICY IF EXISTS chat_reactions_channel_select ON public.chat_reactions;
CREATE POLICY chat_reactions_channel_select
  ON public.chat_reactions
  FOR SELECT
  TO authenticated
  USING (
    (org_id IS NOT NULL AND org_id IN (SELECT public.current_user_org_ids()))
    OR
    (protocol_id IS NOT NULL AND public.user_can_access_protocol(protocol_id))
  );

-- INSERT: only own reactions (user_id = auth.uid()), and only if the user
-- can see the parent channel.
DROP POLICY IF EXISTS chat_reactions_self_insert ON public.chat_reactions;
CREATE POLICY chat_reactions_self_insert
  ON public.chat_reactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      (org_id IS NOT NULL AND org_id IN (SELECT public.current_user_org_ids()))
      OR
      (protocol_id IS NOT NULL AND public.user_can_access_protocol(protocol_id))
    )
  );

-- DELETE: only own reactions. Admins don't moderate reactions.
DROP POLICY IF EXISTS chat_reactions_self_delete ON public.chat_reactions;
CREATE POLICY chat_reactions_self_delete
  ON public.chat_reactions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- Realtime sub needs publication membership.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_reactions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_reactions';
  END IF;
END $$;
