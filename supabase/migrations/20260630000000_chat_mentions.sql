-- =============================================================================
-- chat_mentions — derived index of `<@<uuid>>` mention tokens embedded in
-- chat message bodies. Populated by SECURITY DEFINER triggers on
-- org_messages + protocol_messages, NOT by client INSERTs — clients can't
-- spoof mentions for users they didn't actually @-mention because the
-- trigger reads NEW.body (the canonical server-stored text) and parses
-- it itself.
--
-- One mention row per (message, mentioned_user) pair. Same message
-- containing the same UUID twice still produces only one row (UNIQUE
-- constraint).
--
-- read_at lives on this table so we can show an "unread @mention" badge
-- on the chat sidebar without re-scanning all message bodies on every
-- render. The mentioned user marks rows as read via the chat hook
-- (`markAsRead`) when they view the channel.
-- =============================================================================


CREATE TABLE IF NOT EXISTS public.chat_mentions (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_message_id        UUID         REFERENCES public.org_messages(id)      ON DELETE CASCADE,
  protocol_message_id   UUID         REFERENCES public.protocol_messages(id) ON DELETE CASCADE,
  -- Denormalized channel reference for cheap per-channel queries + cheap
  -- realtime routing (the trigger fills these from the parent message,
  -- so clients don't need a join to learn which channel a mention
  -- belongs to).
  org_id                UUID         REFERENCES public.orgs(id)              ON DELETE CASCADE,
  protocol_id           UUID         REFERENCES public.protocols(id)         ON DELETE CASCADE,
  mentioned_user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mentioned_by_user_id  UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  read_at               TIMESTAMPTZ,
  CONSTRAINT chat_mentions_message_xor CHECK (
    (org_message_id IS NOT NULL AND protocol_message_id IS NULL
      AND org_id IS NOT NULL AND protocol_id IS NULL)
    OR
    (org_message_id IS NULL AND protocol_message_id IS NOT NULL
      AND org_id IS NULL AND protocol_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_mentions_org_msg_user_uniq
  ON public.chat_mentions(org_message_id, mentioned_user_id)
  WHERE org_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS chat_mentions_protocol_msg_user_uniq
  ON public.chat_mentions(protocol_message_id, mentioned_user_id)
  WHERE protocol_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_mentions_mentioned_user_id_idx
  ON public.chat_mentions(mentioned_user_id, read_at);


ALTER TABLE public.chat_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_mentions_self_select" ON public.chat_mentions
  FOR SELECT TO authenticated
  USING (mentioned_user_id = auth.uid());

CREATE POLICY "chat_mentions_self_update" ON public.chat_mentions
  FOR UPDATE TO authenticated
  USING (mentioned_user_id = auth.uid())
  WITH CHECK (mentioned_user_id = auth.uid());


CREATE OR REPLACE FUNCTION public.extract_chat_mentions_from_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mention_uuid TEXT;
  parsed_uuid UUID;
BEGIN
  FOR mention_uuid IN
    SELECT (regexp_matches(NEW.body,
      '<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>',
      'g'))[1]
  LOOP
    BEGIN
      parsed_uuid := mention_uuid::UUID;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;

    IF TG_TABLE_NAME = 'org_messages' THEN
      INSERT INTO public.chat_mentions (
        org_message_id, org_id, mentioned_user_id, mentioned_by_user_id
      )
      SELECT NEW.id, NEW.org_id, parsed_uuid, NEW.author_user_id
      WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = parsed_uuid)
      ON CONFLICT (org_message_id, mentioned_user_id)
        WHERE org_message_id IS NOT NULL
        DO NOTHING;
    ELSIF TG_TABLE_NAME = 'protocol_messages' THEN
      INSERT INTO public.chat_mentions (
        protocol_message_id, protocol_id, mentioned_user_id, mentioned_by_user_id
      )
      SELECT NEW.id, NEW.protocol_id, parsed_uuid, NEW.author_user_id
      WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = parsed_uuid)
      ON CONFLICT (protocol_message_id, mentioned_user_id)
        WHERE protocol_message_id IS NOT NULL
        DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_extract_mentions_org_messages
  AFTER INSERT ON public.org_messages
  FOR EACH ROW EXECUTE FUNCTION public.extract_chat_mentions_from_message();

CREATE TRIGGER trg_extract_mentions_protocol_messages
  AFTER INSERT ON public.protocol_messages
  FOR EACH ROW EXECUTE FUNCTION public.extract_chat_mentions_from_message();


CREATE OR REPLACE FUNCTION public.mark_chat_mentions_read(
  p_kind TEXT,
  p_channel_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_kind = 'org' THEN
    UPDATE public.chat_mentions
    SET read_at = NOW()
    WHERE mentioned_user_id = auth.uid()
      AND read_at IS NULL
      AND org_message_id IN (
        SELECT id FROM public.org_messages WHERE org_id = p_channel_id
      );
  ELSIF p_kind = 'protocol' THEN
    UPDATE public.chat_mentions
    SET read_at = NOW()
    WHERE mentioned_user_id = auth.uid()
      AND read_at IS NULL
      AND protocol_message_id IN (
        SELECT id FROM public.protocol_messages WHERE protocol_id = p_channel_id
      );
  END IF;
END;
$$;


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_mentions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_mentions;
  END IF;
END $$;
