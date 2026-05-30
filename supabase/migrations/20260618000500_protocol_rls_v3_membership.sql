-- =============================================================================
-- RLS v3 — tighten site_* data access from "any org member" to "explicit
-- protocol member (or guest, or future sponsor)".
--
-- What changes vs v2 (20260520000200_owner_scoped_rls_v2):
--
--   protocols                      — SELECT broadened: org-members see all
--                                    org protocols (metadata) AND guests +
--                                    future sponsors see their own protocols.
--                                    MODIFY tightened from "owner_id = uid OR
--                                    org admin" to "protocol coordinator OR
--                                    org admin".
--   site_participants              — was: any org-member can read+write all
--                                    protocols of the org. Now: only callers
--                                    user_can_access_protocol returns true for.
--   site_visits                    — same upgrade.
--   site_team_members              — same upgrade.
--
-- The visibility model from the org-workspaces plan:
--   - Org members see a roster of all org protocols (name, study #, sponsor)
--     — first clause of the new protocols.SELECT policy.
--   - Guests see metadata for protocols they're invited to (so the UI can
--     render the protocol header before loading data) — second clause via
--     user_can_access_protocol.
--   - Org members CANNOT see protocol DATA unless explicitly added to
--     protocol_members (or invited as a guest, or — future — viewing via
--     sponsor relationship). The site_* policies enforce this.
--
-- Notes:
--   - Existing protocols' owners were backfilled into protocol_members as
--     coordinator in 20260618000000, so no one loses access to their own
--     protocols on this migration.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Drop policies being replaced. Idempotent.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "protocols_owner_select"          ON public.protocols;
DROP POLICY IF EXISTS "protocols_owner_modify"          ON public.protocols;
DROP POLICY IF EXISTS "site_participants_via_protocol"  ON public.site_participants;
DROP POLICY IF EXISTS "site_visits_via_protocol"        ON public.site_visits;
DROP POLICY IF EXISTS "site_team_members_via_protocol"  ON public.site_team_members;


-- ---------------------------------------------------------------------------
-- protocols — SELECT covers org-roster visibility + guest/sponsor metadata
-- access. MODIFY is coordinator-or-org-admin.
-- ---------------------------------------------------------------------------
CREATE POLICY "protocols_visible_select" ON public.protocols
  FOR SELECT TO authenticated
  USING (
    -- (a) metadata-public-within-org — any org member sees their org's
    -- protocols in a roster, with Request Access affordance.
    owner_org_id IN (SELECT public.current_user_org_ids())
    -- (b) guest or sponsor access to a specific protocol grants metadata too.
    OR public.user_can_access_protocol(auth.uid(), id)
  );

CREATE POLICY "protocols_coordinator_or_admin_modify" ON public.protocols
  FOR ALL TO authenticated
  USING (
    id IN (SELECT public.current_user_protocol_coordinator_ids())
    OR owner_org_id IN (SELECT public.current_user_admin_org_ids())
  )
  WITH CHECK (
    id IN (SELECT public.current_user_protocol_coordinator_ids())
    OR owner_org_id IN (SELECT public.current_user_admin_org_ids())
  );


-- ---------------------------------------------------------------------------
-- site_participants — gated by user_can_access_protocol.
-- ---------------------------------------------------------------------------
CREATE POLICY "site_participants_membership_gated" ON public.site_participants
  FOR ALL TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id))
  WITH CHECK (public.user_can_access_protocol(auth.uid(), protocol_id));


-- ---------------------------------------------------------------------------
-- site_visits — gated by user_can_access_protocol.
-- ---------------------------------------------------------------------------
CREATE POLICY "site_visits_membership_gated" ON public.site_visits
  FOR ALL TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id))
  WITH CHECK (public.user_can_access_protocol(auth.uid(), protocol_id));


-- ---------------------------------------------------------------------------
-- site_team_members — gated by user_can_access_protocol.
-- ---------------------------------------------------------------------------
CREATE POLICY "site_team_members_membership_gated" ON public.site_team_members
  FOR ALL TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id))
  WITH CHECK (public.user_can_access_protocol(auth.uid(), protocol_id));
