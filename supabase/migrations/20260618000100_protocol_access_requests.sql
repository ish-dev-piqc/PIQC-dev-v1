-- =============================================================================
-- protocol_access_requests — user-initiated "request to join this protocol".
--
-- Flow:
--   1. A user who can see a protocol's metadata (via metadata-public-within-org
--      RLS on protocols, unchanged from owner_scoped_rls_v2) but isn't a
--      protocol_member clicks "Request Access" on the protocol card.
--   2. A row is inserted here with status='pending', user_id=auth.uid().
--   3. A coordinator of the protocol sees the request in their queue,
--      approves or denies it. Approval is handled by an RPC that inserts into
--      protocol_members AND flips status to 'approved' in one transaction
--      (out of scope for this migration; the RPC lives in the orgsApi PR).
--
-- Access scoping (RLS):
--   - Same-org-only: a user can only request access to protocols owned by
--     an org they're a member of. This is consistent with the visibility
--     model — you can only ask for what you can see.
--   - Requester sees their own requests; coordinator sees the queue for
--     their protocols.
--
-- The `pending` uniqueness constraint prevents the same user spamming
-- multiple open requests against the same protocol. Once resolved
-- (approved/denied/withdrawn), the row stays for audit; a new request can
-- be filed.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.protocol_access_requests (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id  UUID         NOT NULL REFERENCES public.protocols(id) ON DELETE CASCADE,
  user_id      UUID         NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,
  status       TEXT         NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'denied', 'withdrawn')),
  message      TEXT,
  requested_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID         REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS protocol_access_requests_protocol_id_idx
  ON public.protocol_access_requests(protocol_id);
CREATE INDEX IF NOT EXISTS protocol_access_requests_user_id_idx
  ON public.protocol_access_requests(user_id);
CREATE INDEX IF NOT EXISTS protocol_access_requests_status_idx
  ON public.protocol_access_requests(status)
  WHERE status = 'pending';

-- Only one pending request per (protocol, user). Resolved rows can stack.
CREATE UNIQUE INDEX IF NOT EXISTS protocol_access_requests_unique_pending_idx
  ON public.protocol_access_requests(protocol_id, user_id)
  WHERE status = 'pending';

ALTER TABLE public.protocol_access_requests ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- SELECT: requester sees their own rows; coordinator sees all rows for
-- protocols they coordinate.
CREATE POLICY "protocol_access_requests_requester_or_coordinator_select"
  ON public.protocol_access_requests
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR protocol_id IN (SELECT public.current_user_protocol_coordinator_ids())
  );

-- INSERT: a user can only file a request for themselves, and only for a
-- protocol owned by an org they're a member of (metadata visibility
-- prerequisite). Not allowed if they're already a protocol_member —
-- application layer should hide the button, but RLS enforces it server-side.
CREATE POLICY "protocol_access_requests_self_insert"
  ON public.protocol_access_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = protocol_id
        AND p.owner_org_id IN (SELECT public.current_user_org_ids())
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.protocol_members pm
      WHERE pm.protocol_id = protocol_access_requests.protocol_id
        AND pm.user_id = auth.uid()
    )
  );

-- UPDATE: requester can withdraw (their own pending row → status='withdrawn').
-- Coordinator can approve/deny (any pending row → status='approved'|'denied').
-- Use of resolved_by is enforced at app layer; RLS just gates who can write.
CREATE POLICY "protocol_access_requests_requester_withdraw"
  ON public.protocol_access_requests
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status IN ('pending', 'withdrawn'));

CREATE POLICY "protocol_access_requests_coordinator_resolve"
  ON public.protocol_access_requests
  FOR UPDATE TO authenticated
  USING (protocol_id IN (SELECT public.current_user_protocol_coordinator_ids()))
  WITH CHECK (protocol_id IN (SELECT public.current_user_protocol_coordinator_ids()));
