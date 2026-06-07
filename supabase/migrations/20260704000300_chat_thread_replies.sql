-- =============================================================================
-- Chat thread replies — add parent_message_id self-FK to both message tables.
--
-- A reply is a regular message row with parent_message_id set. The main
-- channel listing filters parent_message_id IS NULL client-side so threads
-- don't clutter the timeline.
--
-- ON DELETE CASCADE: deleting a parent (hard-delete) wipes its thread.
-- Soft-deleted parents (deleted_at IS NOT NULL) keep their replies — the
-- UI renders a placeholder bubble for the parent but the thread is intact.
-- =============================================================================

ALTER TABLE public.org_messages
  ADD COLUMN IF NOT EXISTS parent_message_id UUID
    REFERENCES public.org_messages(id) ON DELETE CASCADE;

ALTER TABLE public.protocol_messages
  ADD COLUMN IF NOT EXISTS parent_message_id UUID
    REFERENCES public.protocol_messages(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS org_messages_parent_idx
  ON public.org_messages (parent_message_id)
  WHERE parent_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS protocol_messages_parent_idx
  ON public.protocol_messages (parent_message_id)
  WHERE parent_message_id IS NOT NULL;

-- No RLS changes needed: thread replies inherit the same
-- {SELECT, INSERT, UPDATE, DELETE} policies as top-level messages. Any
-- user who can read a channel can read its threads; any user who can
-- post in the channel can reply in its threads.
