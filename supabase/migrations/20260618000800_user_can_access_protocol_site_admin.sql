-- =============================================================================
-- user_can_access_protocol — add clause (d) for site administrators.
--
-- Site administrators (org_members.role='admin') of the protocol's owning org
-- get implicit data access to every protocol that org owns, without needing
-- an explicit protocol_members row. This matches the product framing: "the
-- organization provides protocols to its users" — the site administrator is
-- the org's authority over its protocol catalog and is expected to see
-- everything in it.
--
-- Final clause list:
--   (a) explicit protocol_member
--   (b) accepted, non-expired guest
--   (c) sponsor relationship (forward-compat, no rows in v1)
--   (d) site administrator of owner_org_id  ← NEW
--
-- Non-admin org members ("site members") still need an explicit
-- protocol_members row for data access — clause (a). Joining an org alone
-- still grants zero protocol-data access; the org-roster metadata view
-- (protocols_visible_select policy, unchanged) is the only thing they see.
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
    -- protocol's owning site-org. Always FALSE in v1 (sponsor_relationships
    -- is empty); flips on when Sponsor Mode admin UI ships.
    EXISTS (
      SELECT 1
      FROM org_members om
      JOIN sponsor_relationships sr ON sr.sponsor_org_id = om.org_id
      JOIN protocols p ON p.id = pid
      WHERE om.user_id = uid
        AND sr.site_org_id = p.owner_org_id
    )
    OR
    -- (d) site administrator of the protocol's owning org. Org-level admin
    -- role implies full access to every protocol the org owns, without
    -- needing explicit protocol_members rows.
    EXISTS (
      SELECT 1
      FROM org_members om
      JOIN protocols p ON p.id = pid
      WHERE om.user_id = uid
        AND om.org_id = p.owner_org_id
        AND om.role = 'admin'
    );
$$;
