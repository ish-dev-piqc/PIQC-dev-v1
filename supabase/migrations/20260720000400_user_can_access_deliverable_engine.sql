-- =============================================================================
-- user_can_access_deliverable_engine — protocol membership AND org
-- entitlement, combined (SEC-ebc361e ENT-1 / MAC-1)
--
-- Deliberately NOT folded into user_can_access_protocol() itself:
-- user_can_access_protocol is the shared primitive for Site Mode data
-- access, coordinator/org-admin protocol access, and sponsor_relationships
-- — none of which should require a paid entitlement. This wrapper is
-- specific to the Protocol Deliverable Engine (Sponsor/CRA mode) surface.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.user_can_access_deliverable_engine(
  p_user        UUID,
  p_protocol_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.user_can_access_protocol(p_user, p_protocol_id)
     AND public.org_has_entitlement(
           (SELECT owner_org_id FROM public.protocols WHERE id = p_protocol_id),
           'deliverable_engine'
         );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_deliverable_engine(UUID, UUID) TO authenticated;
