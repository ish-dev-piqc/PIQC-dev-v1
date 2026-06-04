-- =============================================================================
-- chat_decisions — first-class clinical-trial decisions promoted from chat.
--
-- A chat message can be elevated to a Decision with a title + optional
-- rationale. The decision lives in its own table and persists even if the
-- source message is deleted (source_*_message_id is ON DELETE SET NULL).
-- Decisions are immutable in v1: no UPDATE policy. Admins can DELETE for
-- moderation.
--
-- Channel membership is encoded the same way as chat_mentions: exactly one
-- of `org_id` / `protocol_id` is set. RLS gates SELECT/INSERT on chat
-- eligibility for that channel.
-- =============================================================================


CREATE TABLE IF NOT EXISTS public.chat_decisions (
  id                            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title                         TEXT         NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  rationale                     TEXT         CHECK (rationale IS NULL OR length(rationale) <= 4000),

  -- Channel reference — exactly one set.
  org_id                        UUID         REFERENCES public.orgs(id)      ON DELETE CASCADE,
  protocol_id                   UUID         REFERENCES public.protocols(id) ON DELETE CASCADE,

  -- Source message — nullable so decisions survive message deletion.
  source_org_message_id         UUID         REFERENCES public.org_messages(id)      ON DELETE SET NULL,
  source_protocol_message_id    UUID         REFERENCES public.protocol_messages(id) ON DELETE SET NULL,

  decided_by_user_id            UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at                    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by_user_id            UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chat_decisions_channel_xor CHECK (
    (org_id IS NOT NULL AND protocol_id IS NULL)
    OR
    (org_id IS NULL AND protocol_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS chat_decisions_org_decided_at_idx
  ON public.chat_decisions(org_id, decided_at DESC)
  WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_decisions_protocol_decided_at_idx
  ON public.chat_decisions(protocol_id, decided_at DESC)
  WHERE protocol_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_decisions_source_org_msg_idx
  ON public.chat_decisions(source_org_message_id)
  WHERE source_org_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_decisions_source_protocol_msg_idx
  ON public.chat_decisions(source_protocol_message_id)
  WHERE source_protocol_message_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_decisions ENABLE ROW LEVEL SECURITY;

-- SELECT — caller can see channel.
CREATE POLICY "chat_decisions_channel_select" ON public.chat_decisions
  FOR SELECT TO authenticated
  USING (
    -- Org-channel: caller is an org member.
    (org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.org_id = chat_decisions.org_id
        AND om.user_id = auth.uid()
    ))
    OR
    -- Protocol-channel: same chat-eligibility as protocol_messages.
    (protocol_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM public.protocol_members pm
        WHERE pm.protocol_id = chat_decisions.protocol_id
          AND pm.user_id = auth.uid()
          AND pm.role IN ('coordinator', 'member')
      )
      OR EXISTS (
        SELECT 1 FROM public.protocols p
        WHERE p.id = chat_decisions.protocol_id
          AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
      )
    ))
  );

-- INSERT — same access predicate + author identity.
CREATE POLICY "chat_decisions_channel_insert" ON public.chat_decisions
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by_user_id = auth.uid()
    AND (
      (org_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.org_id = chat_decisions.org_id
          AND om.user_id = auth.uid()
      ))
      OR
      (protocol_id IS NOT NULL AND (
        EXISTS (
          SELECT 1 FROM public.protocol_members pm
          WHERE pm.protocol_id = chat_decisions.protocol_id
            AND pm.user_id = auth.uid()
            AND pm.role IN ('coordinator', 'member')
        )
        OR EXISTS (
          SELECT 1 FROM public.protocols p
          WHERE p.id = chat_decisions.protocol_id
            AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
        )
      ))
    )
  );

-- DELETE — org admin only (mistakes happen; org admins moderate).
CREATE POLICY "chat_decisions_admin_delete" ON public.chat_decisions
  FOR DELETE TO authenticated
  USING (
    (org_id IS NOT NULL AND org_id IN (SELECT public.current_user_admin_org_ids()))
    OR
    (protocol_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = chat_decisions.protocol_id
        AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
    ))
  );

-- No UPDATE policy — decisions are immutable in v1.


-- ---------------------------------------------------------------------------
-- Realtime publication (idempotent re-runs).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_decisions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_decisions;
  END IF;
END $$;
