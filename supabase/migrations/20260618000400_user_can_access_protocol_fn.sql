-- =============================================================================
-- user_can_access_protocol — the single authorisation primitive.
--
-- Returns TRUE iff the given user is allowed to access the given protocol's
-- data (site_participants, site_visits, site_team_members, future
-- collaboration tables). Three clauses, OR'd:
--
--   (a) Explicit protocol_member  — primary v1 path
--   (b) Accepted, non-expired guest — external collaborator flow
--   (c) Sponsor relationship      — placeholder for Sponsor Mode (no rows in v1)
--
-- All RLS on protocol-scoped data tables routes through this function. That
-- means future modes can extend the access surface without touching policies.
-- SECURITY DEFINER so it can read protocol_members / protocol_guests /
-- sponsor_relationships regardless of caller RLS (the recursion-safety
-- pattern from 20260523010000_org_rls_break_recursion).
--
-- Takes (uid, pid) as parameters rather than relying on auth.uid() so it's
-- usable in administrative contexts (impersonation, RPCs, debugging) — but
-- the standard RLS use is `user_can_access_protocol(auth.uid(), protocol_id)`.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.user_can_access_protocol(uid UUID, pid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    -- (a) explicit protocol member (any role: coordinator / member / viewer)
    EXISTS (
      SELECT 1 FROM protocol_members
      WHERE protocol_id = pid AND user_id = uid
    )
    OR
    -- (b) accepted, non-expired guest
    EXISTS (
      SELECT 1 FROM protocol_guests
      WHERE protocol_id = pid
        AND user_id = uid
        AND accepted_at IS NOT NULL
        AND (expires_at IS NULL OR expires_at > NOW())
    )
    OR
    -- (c) sponsor mode — user belongs to a sponsor org sponsoring the
    -- protocol's owning site-org. Always FALSE in v1 (no rows in
    -- sponsor_relationships); flips on when Sponsor Mode admin UI ships.
    EXISTS (
      SELECT 1
      FROM org_members om
      JOIN sponsor_relationships sr ON sr.sponsor_org_id = om.org_id
      JOIN protocols p ON p.id = pid
      WHERE om.user_id = uid
        AND sr.site_org_id = p.owner_org_id
    );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_protocol(UUID, UUID) TO authenticated;
