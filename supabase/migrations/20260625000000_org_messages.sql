-- =============================================================================
-- org_messages — org-wide general chat channel.
--
-- PR 4a of the Organization-page chat sequence. One row per message, one
-- channel per org (no per-channel concept yet — PR 4b introduces it for
-- per-protocol channels).
--
-- Membership-gated reads + inserts via org_members. Authors and org admins
-- can delete; nobody can update (messages are immutable in v1). Added to
-- the supabase_realtime publication so the Chat tab can subscribe to
-- INSERTs.
-- =============================================================================


CREATE TABLE IF NOT EXISTS public.org_messages (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL so removing a user from auth.users doesn't take
  -- their post history with them — UI renders "Deleted user" for nulls.
  author_user_id  UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  body            TEXT         NOT NULL CHECK (length(body) > 0 AND length(body) <= 10000),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Listing query is `WHERE org_id = ? ORDER BY created_at DESC LIMIT N`,
-- which this composite index serves directly.
CREATE INDEX IF NOT EXISTS org_messages_org_id_created_at_idx
  ON public.org_messages(org_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.org_messages ENABLE ROW LEVEL SECURITY;

-- SELECT — any org_members row for this org_id allows reads.
CREATE POLICY "org_messages_member_select" ON public.org_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.org_id = org_messages.org_id
        AND om.user_id = auth.uid()
    )
  );

-- INSERT — caller is in org_members AND author_user_id = self. Blocks
-- impersonation at the policy layer (in addition to the app-level check).
CREATE POLICY "org_messages_member_insert" ON public.org_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.org_id = org_messages.org_id
        AND om.user_id = auth.uid()
    )
  );

-- DELETE — author can remove their own; org admins can remove any in
-- their org (basic moderation).
CREATE POLICY "org_messages_self_or_admin_delete" ON public.org_messages
  FOR DELETE TO authenticated
  USING (
    author_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.org_id = org_messages.org_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );

-- No UPDATE policy — messages are immutable in v1.


-- ---------------------------------------------------------------------------
-- Realtime publication — wrapped in a DO block so re-running the migration
-- (or running it against a project where supabase_realtime is configured
-- differently) doesn't error on a duplicate-table add.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'org_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.org_messages;
  END IF;
END $$;
