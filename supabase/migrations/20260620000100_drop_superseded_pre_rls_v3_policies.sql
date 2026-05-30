-- =============================================================================
-- Drop the pre-RLS-v3 policies that RLS-v3 failed to remove.
--
-- 20260618000500_protocol_rls_v3_membership.sql DROPs policies by the names
-- "protocols_owner_select / _modify" and "site_*_via_protocol", but this DB's
-- actual policies were named "*_org_access_select", "*_owning_org_admin_modify"
-- and "*_via_protocol_access". So the new membership-gated policies were added
-- ALONGSIDE the old org-wide ones. Multiple permissive policies are OR'd, so
-- the old org-wide grants defeated the new membership tightening — removing a
-- protocol_member didn't actually revoke their data access.
--
-- This drops the superseded old policies so the RLS-v3 membership model
-- (user_can_access_protocol) is the sole gate on protocol data. Verified before
-- applying that current legitimate users still pass: protocol owners (backfilled
-- as coordinators), owner-org admins, and explicitly-added members.
--
-- protocols SELECT keeps protocols_visible_select (org members still see
-- protocol METADATA for the roster + request-access affordance; the site_*
-- tables hold the gated DATA).
-- =============================================================================

DROP POLICY IF EXISTS protocols_org_access_select          ON public.protocols;
DROP POLICY IF EXISTS protocols_owning_org_admin_modify    ON public.protocols;
DROP POLICY IF EXISTS site_participants_via_protocol_access ON public.site_participants;
DROP POLICY IF EXISTS site_visits_via_protocol_access       ON public.site_visits;
DROP POLICY IF EXISTS site_team_members_via_protocol_access ON public.site_team_members;
