import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../context/OrgContext';

// =============================================================================
// useDeliverableEntitlement
//
// Client read of the *real* Protocol Deliverable Engine grant. The Sponsor and
// CRA surfaces used to gate on `subscription.kind === 'enterprise'`, a tier
// with no Stripe price that no code path can set — so the gate blocked 100% of
// users while the backend engine was live. The truth lives in the
// `org_entitlements` table (capability = 'deliverable_engine'), granted per org
// by an ops INSERT. The table is RLS deny-all; the only read path is the
// SECURITY DEFINER `org_has_entitlement(org_id, capability)` RPC (granted to
// `authenticated`, shipped with #479's ENT-1/MAC-1 server hardening).
//
// We key the check on the active protocol's owner org (`protocolOwnerOrgId`
// from OrgContext) — the same org the backend's per-protocol RLS gates on — so
// the client can never disagree with the server about whether the surface is
// available. The server RPC/RLS is the real boundary; this hook only decides
// whether to render the surface or the calm gate card.
//
// Fetch lives here, not in the component (the `useSubscription` precedent).
// =============================================================================

const DELIVERABLE_ENGINE_CAPABILITY = 'deliverable_engine';

export interface DeliverableEntitlement {
  hasEntitlement: boolean;
  loading: boolean;
}

export function useDeliverableEntitlement(): DeliverableEntitlement {
  const { protocolOwnerOrgId, loading: orgLoading } = useOrg();
  const [hasEntitlement, setHasEntitlement] = useState(false);
  // The org id we've resolved a capability answer for. Comparing it to the
  // current `protocolOwnerOrgId` tells us whether the answer we hold is stale —
  // which covers the one-frame window between the owner org landing (orgLoading
  // flips false) and this effect running, so an entitled user never sees a
  // gate-card flash.
  const [checkedOrgId, setCheckedOrgId] = useState<string | null>(null);

  useEffect(() => {
    // No active protocol → no owner org to check. Nothing to grant, nothing to
    // load; the surface's own empty state handles the "no protocol" case.
    if (!protocolOwnerOrgId) {
      setHasEntitlement(false);
      setCheckedOrgId(null);
      return;
    }

    let cancelled = false;
    supabase
      .rpc('org_has_entitlement', {
        p_org_id: protocolOwnerOrgId,
        p_capability: DELIVERABLE_ENGINE_CAPABILITY,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('[useDeliverableEntitlement] org_has_entitlement error:', error);
          setHasEntitlement(false);
        } else {
          // RPC returns a plain boolean; guard against null/unknown either way.
          setHasEntitlement(data === true);
        }
        // Mark resolved for this org even on error, so we fail closed to the
        // gate card instead of spinning forever.
        setCheckedOrgId(protocolOwnerOrgId);
      });

    return () => {
      cancelled = true;
    };
  }, [protocolOwnerOrgId]);

  // Loading while OrgContext is still settling the active protocol's owner org,
  // or while we hold no fresh capability answer for the current owner org.
  const pendingCheck =
    protocolOwnerOrgId != null && checkedOrgId !== protocolOwnerOrgId;
  return { hasEntitlement, loading: orgLoading || pendingCheck };
}
