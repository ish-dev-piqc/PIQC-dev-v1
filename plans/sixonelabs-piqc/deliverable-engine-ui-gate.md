---
owner: sixonelabs-piqc
feature: deliverable-engine-ui-gate
status: active
started: 2026-07-08
target_pr:
---

# Deliverable Engine — UI gate alignment

## Context

The Sponsor/CRA Deliverable Engine surfaces are gated in the UI by
`canUseSponsorMode`/`canUseCraMode`, which check `subscription.kind === 'enterprise'`
— a tier that has no Stripe price and no code path can ever set, so the gate blocks
100% of real users even though the backend engine is live. Kiara's #479
(`security-fixes-enterprise-access`, ENT-1/MAC-1) already shipped the server half:
`org_entitlements` + the `org_has_entitlement()` SECURITY DEFINER RPC (granted to
`authenticated`), and hardened the deliverable RPC/RLS. This feature aligns the UI
gate to that real capability so an org holding the `deliverable_engine` entitlement
actually sees the surface — without reintroducing a dead enterprise-only gate.

Design signed off by founder (2026-07-08): read the capability via
`org_has_entitlement(protocolOwnerOrgId, 'deliverable_engine')` in a new hook; keep
the entitlement decision as pure functions.

## Scope (files allowed)

- `plans/sixonelabs-piqc/deliverable-engine-ui-gate.md` (this plan)
- `src/hooks/useDeliverableEntitlement.ts` — NEW. Reads `protocolOwnerOrgId` from
  `useOrg()`, calls `supabase.rpc('org_has_entitlement', { p_org_id, p_capability:
  'deliverable_engine' })`, returns `{ hasEntitlement, loading }`. Mirrors the
  `useSubscription` precedent (fetch lives in a hook, not the component).
- `src/lib/entitlements.ts` — repurpose `canUseSponsorMode`/`canUseCraMode` to take
  the capability boolean instead of `subscription.kind`; rewrite reason/gate copy to
  drop the dead "enterprise tier" language. Functions stay pure + separate
  (product-lever decoupling preserved).
- `src/lib/__tests__/entitlements.test.ts` — update the two gate tests to the new
  boolean signature; add entitled/non-entitled cases.
- `src/components/dashboard/sponsor/deliverables/ProtocolIntelligenceTab.tsx` —
  consume the hook, thread the boolean through the pure gate, add an entitlement
  loading branch, update gate-card copy.
- `src/components/dashboard/cra/CraWorkspaceShell.tsx` — same wiring for the CRA
  workspace.

## Out of scope (files forbidden)

- `src/context/OrgContext.tsx` — read via `useOrg()`, never modified (avoids a 2nd
  2-reviewer shared-infra file; `protocolOwnerOrgId` already exists there).
- `src/hooks/useSubscription.ts`, `src/stripe-config.ts` — the subscription/pricing
  path is untouched; this gate no longer keys off `subscription.kind`.
- `supabase/**` — the `org_entitlements` table + `org_has_entitlement` RPC already
  shipped in #479; no migration/RPC changes here.
- `src/lib/entitlements.ts` capacity-cap functions (`canInviteUser`,
  `canAddProtocol`, `canInviteGuest`, `canInviteViewer`, `hasAddon`) — left to
  Kiara's active MAC-1 capacity-cap follow-up (disjoint region of the same file).
- `src/lib/deliverables/**`, `src/components/deliverables/**` — the engine itself is
  consumed, never modified.
- Other mode dirs (`site/`, `audit/`, `sotr/`, VEW).

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [x] context (`src/hooks/useDeliverableEntitlement.ts` — client capability read path)
- [x] component (`src/components/`)
- [x] test (`src/lib/__tests__/`)

## Mock data plan

None.

## Approved-by

- @ish-dev-piqc + @ki-dev-piqc — for `src/lib/entitlements.ts` and its sibling
  `src/lib/__tests__/entitlements.test.ts` (2-reviewer shared-infra lane per CODEOWNERS).
- @fable-dev-piqc — for
  `src/components/dashboard/sponsor/deliverables/ProtocolIntelligenceTab.tsx`
  (Protocol Deliverable Engine ownership). `CraWorkspaceShell.tsx` is unowned per
  CODEOWNERS but is Fable's CRA surface — tag Fable as courtesy reviewer.

### Coexistence note — entitlements.ts

`plans/kiara/security-fixes-enterprise-access.md` (active) also scopes
`src/lib/entitlements.ts`. Its shipped ENT-1/MAC-1 work (#479, merged) deliberately
left `canUseSponsorMode`/`canUseCraMode` untouched — the client gate was never the
security boundary — making this UI alignment the intended continuation. The only
remaining live part of Kiara's plan is the MAC-1 capacity-cap follow-up
(`canInviteUser`/`canAddProtocol` seat/protocol limits), a disjoint region of the
file. No branch is ahead of `main` on `entitlements.ts` at intake. Low
merge-conflict risk; coordinate on `entitlements.ts` if her follow-up lands first.

## Verification

- [ ] Entitled path: an org member whose org holds an `org_entitlements` row with
  `capability = 'deliverable_engine'` (via the ops INSERT) sees the Sponsor Protocol
  Intelligence tab and the CRA workspace render their content (not the gate card).
- [ ] Blocked path: a non-entitled org member still sees the calm gate card (new,
  non-enterprise copy) on both surfaces.
- [ ] Loading: while `org_has_entitlement` resolves, the surface shows a spinner and
  does not flash either the gate card or the content.
- [ ] `canUseSponsorMode(false)`/`canUseCraMode(false)` → `allowed: false` with the
  rewritten reason; `(true)` → `allowed: true`. Covered in
  `src/lib/__tests__/entitlements.test.ts`.
- [ ] No `any` / `as any` in `src/lib/**` or the new hook.
- [ ] `tsc` + `vitest` green.
