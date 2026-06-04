-- =============================================================================
-- chat_decision_acks — required acknowledgments for a chat decision.
--
-- When a user promotes a chat message to a decision, they can optionally
-- name a set of users who must explicitly acknowledge. Each named user
-- gets one row; `acknowledged_at` flips from NULL to NOW() when they
-- click Acknowledge in the UI.
--
-- Use case: protocol amendment that the PI, sub-investigators, and
-- coordinator must all ack before it takes effect.
--
-- - INSERT: only the decision creator. Anyone else inserting acks would
--   let bad actors fabricate compliance requirements.
-- - UPDATE: only the required user. Used to flip null → now() + optional
--   note when they acknowledge.
-- - DELETE: creator or org admin. Decisions are immutable; their ack
--   list isn't, in case the creator picked the wrong person.
-- =============================================================================


CREATE TABLE IF NOT EXISTS public.chat_decision_acks (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id        UUID         NOT NULL REFERENCES public.chat_decisions(id) ON DELETE CASCADE,
  required_user_id   UUID         NOT NULL REFERENCES auth.users(id)            ON DELETE CASCADE,
  acknowledged_at    TIMESTAMPTZ,
  acknowledged_note  TEXT         CHECK (
                       acknowledged_note IS NULL
                       OR length(acknowledged_note) <= 2000
                     ),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_decision_acks_unique_per_user UNIQUE (decision_id, required_user_id)
);

CREATE INDEX IF NOT EXISTS chat_decision_acks_decision_id_idx
  ON public.chat_decision_acks(decision_id);
CREATE INDEX IF NOT EXISTS chat_decision_acks_required_user_pending_idx
  ON public.chat_decision_acks(required_user_id, acknowledged_at);


ALTER TABLE public.chat_decision_acks ENABLE ROW LEVEL SECURITY;

-- SELECT — delegated to chat_decisions's RLS via EXISTS subquery.
-- Anyone who can see the parent decision can see its ack list.
CREATE POLICY "chat_decision_acks_channel_select" ON public.chat_decision_acks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_decisions d
      WHERE d.id = chat_decision_acks.decision_id
      -- chat_decisions SELECT RLS will gate this access — `d` is only
      -- visible if the caller can read it.
    )
  );

-- INSERT — only the decision creator can name required users.
CREATE POLICY "chat_decision_acks_creator_insert" ON public.chat_decision_acks
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_decisions d
      WHERE d.id = chat_decision_acks.decision_id
        AND d.created_by_user_id = auth.uid()
    )
  );

-- UPDATE — only the required user, and only updates the acknowledged
-- fields. (RLS doesn't gate per-column; the application is trusted to
-- only set acknowledged_at + acknowledged_note. A future bullet-proof
-- pass could split via two policies on the same table.)
CREATE POLICY "chat_decision_acks_self_update" ON public.chat_decision_acks
  FOR UPDATE TO authenticated
  USING (required_user_id = auth.uid())
  WITH CHECK (required_user_id = auth.uid());

-- DELETE — creator or org admin of the decision's channel.
CREATE POLICY "chat_decision_acks_creator_or_admin_delete" ON public.chat_decision_acks
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_decisions d
      WHERE d.id = chat_decision_acks.decision_id
        AND (
          d.created_by_user_id = auth.uid()
          OR (
            d.org_id IS NOT NULL
            AND d.org_id IN (SELECT public.current_user_admin_org_ids())
          )
          OR (
            d.protocol_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.protocols p
              WHERE p.id = d.protocol_id
                AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
            )
          )
        )
    )
  );


-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_decision_acks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_decision_acks;
  END IF;
END $$;
