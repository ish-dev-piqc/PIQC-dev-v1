-- =============================================================================
-- protocol_guests — external collaborators invited per-protocol.
--
-- A guest is someone who needs access to a single protocol but is NOT a member
-- of the owning org. They don't count against the org's seat quota until the
-- per-protocol guest cap is exceeded — at that point, additional invites are
-- billed via the `addon_guest_seats` Stripe addon and stored with
-- is_paid_seat=true. The free/paid distinction is informational; cap
-- enforcement happens at the application layer in entitlements.ts.
--
-- Token flow:
--   1. Coordinator submits an email + (optional) role hint via InviteGuestModal.
--   2. Server generates a cryptographically random invite_token, inserts
--      a row with user_id=NULL, accepted_at=NULL, expires_at=now()+30d.
--   3. Coordinator copies the magic link out-of-band (email/Slack).
--   4. Recipient clicks the link → if not signed in, lands on Login first
--      → on dashboard load, the accept-invite RPC resolves the token,
--      sets user_id=auth.uid() + accepted_at=now(), and the guest can now
--      access the protocol via clause (b) of user_can_access_protocol.
--
-- Revocation: coordinator deletes the row (or sets expires_at into the past)
-- — access is gone on the next request cycle. There's no soft-delete; guest
-- invites are operational state, not audit-bearing.
--
-- Email collision: if the invited_email matches an existing user_profile
-- whose org_id is the protocol's owner_org_id, the application layer should
-- short-circuit to inserting a protocol_members row directly (they're already
-- in the org — they don't need a guest invite, they need a protocol
-- membership). Enforced in code, not RLS.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.protocol_guests (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id   UUID         NOT NULL REFERENCES public.protocols(id) ON DELETE CASCADE,
  invited_email TEXT         NOT NULL,
  invited_by    UUID         NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  user_id       UUID         REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_token  TEXT         NOT NULL UNIQUE,
  accepted_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  is_paid_seat  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS protocol_guests_protocol_id_idx ON public.protocol_guests(protocol_id);
CREATE INDEX IF NOT EXISTS protocol_guests_user_id_idx     ON public.protocol_guests(user_id);
CREATE INDEX IF NOT EXISTS protocol_guests_email_idx       ON public.protocol_guests(invited_email);

-- Count active (accepted + not expired) guests per protocol — used by the
-- canInviteGuest entitlement check.
-- NOTE: index predicates must be IMMUTABLE — NOW() is not allowed (SQLSTATE
-- 42P17). Partial on accepted guests only, with expires_at as an index column;
-- the not-expired filter is applied at query time in the entitlement check.
CREATE INDEX IF NOT EXISTS protocol_guests_active_count_idx
  ON public.protocol_guests(protocol_id, is_paid_seat, expires_at)
  WHERE accepted_at IS NOT NULL;

ALTER TABLE public.protocol_guests ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- SECURITY DEFINER helper — protocols the calling user has accepted-guest
-- access to. Used by user_can_access_protocol (next migration). Mirrors the
-- recursion-breaking pattern.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_guest_protocol_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT protocol_id FROM protocol_guests
  WHERE user_id = auth.uid()
    AND accepted_at IS NOT NULL
    AND (expires_at IS NULL OR expires_at > NOW());
$$;

GRANT EXECUTE ON FUNCTION public.current_user_guest_protocol_ids() TO authenticated;


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- SELECT: coordinator of the protocol sees the full guest list; an accepted
-- guest sees their own row (so the client can show "you're a guest on this
-- protocol" + expiry warnings).
CREATE POLICY "protocol_guests_coordinator_or_self_select"
  ON public.protocol_guests
  FOR SELECT TO authenticated
  USING (
    protocol_id IN (SELECT public.current_user_protocol_coordinator_ids())
    OR user_id = auth.uid()
  );

-- INSERT/DELETE: coordinators of the protocol only. Cap enforcement is
-- application-layer (entitlements.ts) — RLS only gates *who* can invite,
-- not *how many*. is_paid_seat is set by application logic based on cap state.
CREATE POLICY "protocol_guests_coordinator_insert"
  ON public.protocol_guests
  FOR INSERT TO authenticated
  WITH CHECK (
    protocol_id IN (SELECT public.current_user_protocol_coordinator_ids())
    AND invited_by = auth.uid()
  );

CREATE POLICY "protocol_guests_coordinator_delete"
  ON public.protocol_guests
  FOR DELETE TO authenticated
  USING (protocol_id IN (SELECT public.current_user_protocol_coordinator_ids()));

-- UPDATE: coordinators can revoke (set expires_at) or extend invites.
-- The accept-token flow runs through a SECURITY DEFINER RPC that bypasses
-- this policy, so no separate "guest self-accept" policy is needed.
CREATE POLICY "protocol_guests_coordinator_update"
  ON public.protocol_guests
  FOR UPDATE TO authenticated
  USING (protocol_id IN (SELECT public.current_user_protocol_coordinator_ids()))
  WITH CHECK (protocol_id IN (SELECT public.current_user_protocol_coordinator_ids()));
