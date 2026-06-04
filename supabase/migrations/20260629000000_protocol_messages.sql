-- =============================================================================
-- protocol_messages — per-protocol chat channel.
--
-- PR 4b of the Organization-page chat sequence. One row per message, one
-- channel per protocol. There's no separate channels table — the channel
-- IS the protocol, and channel membership IS protocol_members membership
-- with the role filter applied at the RLS layer.
--
-- Roles permitted to read + post:
--   - protocol_members.role = 'coordinator'  (full read/write)
--   - protocol_members.role = 'member'       (full read/write)
--   - org_members.role      = 'admin'        (implicit access to all org protocols)
--
-- Explicitly excluded:
--   - protocol_members.role = 'viewer'   (read-only on protocol data; not collaborators)
--   - protocol_guests                    (external observers; not collaborators)
--
-- DELETE permitted for: author (self), org admin, protocol coordinator.
-- No UPDATE — messages are immutable in v1, same as org_messages.
-- =============================================================================


CREATE TABLE IF NOT EXISTS public.protocol_messages (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id     UUID         NOT NULL REFERENCES public.protocols(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL so removing a user from auth.users doesn't take
  -- their post history with them — UI renders "Deleted user" for nulls.
  author_user_id  UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  body            TEXT         NOT NULL CHECK (length(body) > 0 AND length(body) <= 10000),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS protocol_messages_protocol_id_created_at_idx
  ON public.protocol_messages(protocol_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.protocol_messages ENABLE ROW LEVEL SECURITY;

-- SELECT — coordinator/member on the protocol, OR org admin of the
-- protocol's owning org. The role filter is the whole point of excluding
-- viewers from chat: they sit in protocol_members with role='viewer'
-- which doesn't satisfy the IN ('coordinator', 'member') predicate.
CREATE POLICY "protocol_messages_chatter_select" ON public.protocol_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.protocol_members pm
      WHERE pm.protocol_id = protocol_messages.protocol_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('coordinator', 'member')
    )
    OR EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = protocol_messages.protocol_id
        AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
    )
  );

-- INSERT — same chat-eligibility check, plus author_user_id = self to
-- block impersonation at the policy layer (defence in depth alongside
-- the app-level check).
CREATE POLICY "protocol_messages_chatter_insert" ON public.protocol_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.protocol_members pm
        WHERE pm.protocol_id = protocol_messages.protocol_id
          AND pm.user_id = auth.uid()
          AND pm.role IN ('coordinator', 'member')
      )
      OR EXISTS (
        SELECT 1 FROM public.protocols p
        WHERE p.id = protocol_messages.protocol_id
          AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
      )
    )
  );

-- DELETE — author can always remove their own posts. Org admins can
-- remove any message in their org's protocols. Protocol coordinators
-- can remove any message in their protocol (basic moderation).
CREATE POLICY "protocol_messages_self_admin_coordinator_delete" ON public.protocol_messages
  FOR DELETE TO authenticated
  USING (
    author_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = protocol_messages.protocol_id
        AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
    )
    OR EXISTS (
      SELECT 1 FROM public.protocol_members pm
      WHERE pm.protocol_id = protocol_messages.protocol_id
        AND pm.user_id = auth.uid()
        AND pm.role = 'coordinator'
    )
  );

-- No UPDATE policy — messages are immutable in v1.


-- ---------------------------------------------------------------------------
-- Realtime publication — wrapped in a DO block so re-running is idempotent.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'protocol_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.protocol_messages;
  END IF;
END $$;
