-- =============================================================================
-- org_entitlements — sales-led capability grants (SEC-ebc361e ENT-1 / MAC-1)
--
-- HIGH findings: canUseSponsorMode()/canUseCraMode() in src/lib/entitlements.ts
-- gate the Sponsor/CRA UI on subscription.kind === 'enterprise' — but
-- 'enterprise' has no Stripe price (src/stripe-config.ts: priceId '',
-- productId '', mode 'none' — "sales-led; no Stripe product") and no other
-- column anywhere represents it. There is currently no live code path that
-- can ever set subscription.kind to 'enterprise', so the UI gate blocks
-- 100% of real users today. The Protocol Deliverable Engine RPCs underneath
-- it, however, only checked user_can_access_protocol (plain membership) —
-- any authenticated protocol member on any plan (free/pilot/workspace)
-- could call deliverable_generate / deliverable_get_packet /
-- deliverable_list_summary / deliverable_portfolio_summary / the block
-- CRUD RPCs directly via supabase.rpc(...), completely bypassing the
-- (already maximally strict) UI gate.
--
-- This follows the exact precedent already set by sponsor_relationships
-- (20260618000300_sponsor_relationships_stub.sql): ship the table EMPTY, no
-- RLS policies (invisible to authenticated users), a SECURITY DEFINER
-- helper reads it regardless of caller RLS, and flipping on a real
-- capability for a real enterprise deal later is just an INSERT — zero
-- further code/schema changes needed at that point.
--
-- Per Kiara (2026-07-07): ship empty / deny-all now; a real self-serve or
-- ops-provisioning flow for enterprise entitlements is a coming feature.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.org_entitlements (
  org_id      UUID         NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  capability  TEXT         NOT NULL,
  granted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  granted_by  UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  note        TEXT,
  PRIMARY KEY (org_id, capability)
);

CREATE INDEX IF NOT EXISTS org_entitlements_org_idx ON public.org_entitlements(org_id);

ALTER TABLE public.org_entitlements ENABLE ROW LEVEL SECURITY;

-- No policies. Table is invisible to all authenticated users, same as
-- sponsor_relationships. Only SECURITY DEFINER functions read it.

-- ---------------------------------------------------------------------------
-- org_has_entitlement — the sole read path. SECURITY DEFINER so callers
-- (RLS policies, other SECURITY DEFINER RPCs) get a straight boolean
-- without needing their own grant on org_entitlements.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_has_entitlement(p_org_id UUID, p_capability TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_entitlements
    WHERE org_id = p_org_id AND capability = p_capability
  );
$$;

GRANT EXECUTE ON FUNCTION public.org_has_entitlement(UUID, TEXT) TO authenticated;

COMMENT ON TABLE public.org_entitlements IS
  'Sales-led / ops-granted capability flags per org (e.g. deliverable_engine '
  'for Sponsor/CRA mode). Ships empty and RLS-locked-down by design — see '
  'header comment. Grant with: INSERT INTO org_entitlements (org_id, '
  'capability, granted_by) VALUES (<org_id>, ''deliverable_engine'', <admin_user_id>);';
