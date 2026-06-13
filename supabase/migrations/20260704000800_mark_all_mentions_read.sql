-- =============================================================================
-- mark_all_chat_mentions_read — cross-channel sweep for the chat overlay's
-- Mentions filter. The existing mark_chat_mentions_read RPC is per-channel;
-- the overlay's mentions inbox spans every channel the user has access to,
-- so it needs a single-call clear.
--
-- SECURITY INVOKER + filter on auth.uid() means RLS isn't bypassed — a
-- caller can only flip rows they own.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mark_all_chat_mentions_read()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_mentions
  SET read_at = NOW()
  WHERE mentioned_user_id = auth.uid()
    AND read_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_chat_mentions_read() TO authenticated;
