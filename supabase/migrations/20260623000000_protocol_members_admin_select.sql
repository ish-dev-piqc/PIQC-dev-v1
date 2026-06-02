-- =============================================================================
-- protocol_members — allow site admins to SELECT rows for their org's protocols.
--
-- The original SELECT policy (in 20260618000000_protocol_members_table.sql)
-- only allows reading rows where the caller is themselves a protocol_member
-- of that protocol. That's correct for a coordinator/member/viewer's own
-- view but it locks site admins out — an org admin has *implicit* access
-- to every protocol owned by their org and never appears in
-- protocol_members directly. Result: in the Organization → Team → PIQC
-- team list, admins see zero rows even though the bulk picker just
-- inserted them (modify policy already grants admins INSERT/UPDATE/DELETE,
-- so the asymmetry was hidden by the write path working fine).
--
-- This migration drops + recreates the SELECT policy to mirror the modify
-- policy's admin clause. After this, admins can list every protocol_members
-- row for protocols owned by orgs they administer.
--
-- The EXISTS subquery here matches the pattern already used by the
-- existing `protocol_members_coordinator_modify` policy on this same table,
-- so any recursion risk would already exist on the write path. No new
-- helper functions needed.
-- =============================================================================

DROP POLICY IF EXISTS "protocol_members_member_select" ON public.protocol_members;

CREATE POLICY "protocol_members_member_select" ON public.protocol_members
  FOR SELECT TO authenticated
  USING (
    protocol_id IN (SELECT public.current_user_protocol_ids())
    OR EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = protocol_members.protocol_id
        AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
    )
  );
