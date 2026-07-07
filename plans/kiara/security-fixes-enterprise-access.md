---
owner: ki-dev-piqc
feature: security-fixes-enterprise-access
status: active
started: 2026-07-07
target_pr:
---

# Security remediation — SEC-ebc361e-enterprise-access findings

## Context

The `fable-audit` security pass (`SEC-ebc361e-enterprise-access`, run against merged `main` @ `ebc361e`, report: `SECURITY-FINDINGS-enterprise-access.md`) found 7 confirmed authorization gaps: authz is enforced client-side but not at the RPC/RLS layer. Two are CRITICAL (invite-redemption RPCs don't bind to the invited email — anyone holding a leaked token can claim someone else's org/protocol-guest access). Four are HIGH (enterprise-tier gates bypassable via direct RPC call, uncapped seat/protocol provisioning, unvalidated Stripe `price_id`, free-text org self-join). Roger is done with his current build work, so this is a good window to land server-side fixes without racing his in-flight branches. Delivered as a phased set of PRs against the same plan, in the report's suggested remediation order, rather than one giant PR — each fix is independently mergeable and revertable.

Kiara has blanket approval to touch any file needed to close these findings, including files under Roger's `supabase/` ownership and the 2-reviewer shared-infra lane (`src/lib/entitlements.ts`, `supabase/functions/stripe-checkout/`). Roger should still review the RPC/RLS diffs before merge given he owns that surface day-to-day — approval here covers making the changes, not skipping his review.

## Scope (files allowed)

- `plans/kiara/security-fixes-enterprise-access.md` (this plan)
- `supabase/migrations/2026072*.sql` (new, append-only — no edits to existing merged migrations)
- `supabase/functions/stripe-checkout/index.ts`
- `src/stripe-config.ts` (read-only reference for the price allowlist; only touched if the catalog needs a server-importable form)
- `src/lib/entitlements.ts`
- `src/lib/orgs/orgsApi.ts` (only if an RPC's response shape changes in a way the client must handle)

## Out of scope (files forbidden)

- Any existing/merged migration file (append-only rule — new migrations only)
- Anything under `src/components/dashboard/{site,audit,sotr}/` (no product UI changes needed for these fixes)
- `src/context/` (no context-layer changes anticipated; if one becomes necessary, expand scope first)

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`.sql`, `supabase/functions/stripe-checkout`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

## Mock data plan

None.

## Approved-by

- @rv61 — for `supabase/migrations/`, `supabase/functions/stripe-checkout/` (codeowner; blanket go-ahead given by Kiara for this remediation, Roger to review diffs on PR)
- Shared-infra 2-reviewer lane applies to `src/lib/entitlements.ts` per CODEOWNERS — needs a second reviewer beyond Kiara before merge.

## Verification

- [ ] ORG-1 / ORG-2: manual RPC call against a staging Supabase instance with a token minted for a *different* user's email — must reject.
- [ ] RLS-1: fresh signup typing an existing org's name on ProfileCompletion must NOT auto-join as member/admin; must land in the existing request/invite flow instead.
- [ ] ENT-1 / MAC-1: authenticated non-enterprise user calling `deliverable_generate` etc. directly via `supabase.rpc(...)` must be rejected server-side, not just hidden in the UI.
- [ ] PAY-1: `stripe-checkout` called with an off-catalog `price_id` must be rejected before hitting Stripe.
- [ ] `tsc` + `vitest` green.
- [ ] Re-run the `fable-audit` security pass after all fixes ship to confirm closure (per the report's own closing note).

## Status by finding

| ID | Fix | Status |
|---|---|---|
| ORG-1 | `accept_org_invite` bind to invited email | done (`20260720000000_accept_org_invite_bind_email.sql`) |
| ORG-2 | `accept_protocol_guest_invite` bind to invited_email | done (`20260720000100_accept_protocol_guest_invite_bind_email.sql`) |
| RLS-1 | kill free-text org self-join | in progress |
| ENT-1 / MAC-1 | server-side tier/capacity checks on deliverable RPCs | in progress |
| PAY-1 | allowlist `price_id` in stripe-checkout | pending |
| MAC-2 | not exploitable yet — tracked, no code change until addon fields land | tracked only |
