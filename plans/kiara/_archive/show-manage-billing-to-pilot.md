---
owner: kiara
feature: show-manage-billing-to-pilot
status: merged
merged: 2026-05-28
started: 2026-05-28
target_pr: #161
---

# Show Manage Billing + Subscribe options to active pilot users

## Context

The dashboard Billing panel currently shows pilot users *only* an
"Upgrade to Workspace — $59 / month" CTA, with no path to manage their
existing billing (receipt, payment method, support contact). The
existing code at `src/components/dashboard/Dashboard.tsx:316-321` has an
explicit comment noting this was a deliberate decision:

> Pilot users: one-time payment, no Stripe Subscription to manage. Show
> the pilot expiry and a clear path to upgrade to a Workspace. We
> deliberately do NOT show the "Manage billing" button because the
> Stripe Customer Portal has nothing useful for one-time Orders.

That call is wrong on two counts:

1. **Pilot users are paying customers** who deserve the same self-service
   billing surface as Workspace customers (receipt, payment method,
   contact support). The Stripe Customer Portal works fine for
   one-time-payment customers — it just hides the subscription section.
2. **The single Upgrade-Monthly CTA feels predatory** — it presents one
   plan as the only forward path. Pilot users should also see the
   Annual option, and the panel should not pressure them into a single
   commitment.

This PR redesigns the pilot Billing panel so pilot users see:
- Their pilot status + expiry (unchanged from today).
- Reassuring description that mentions cancellation freedom.
- Two subscribe options: Workspace Monthly ($59/mo) and Workspace
  Annual ($599/yr), as inline plan-choice buttons matching the existing
  no-plan branch pattern (`Dashboard.tsx:425-478`).
- A "Manage billing" button matching the Workspace branch's visual
  treatment, opening the Stripe Customer Portal.
- Helper text under Manage Billing explaining what's there
  (pilot-specific copy — no "cancel your subscription" since there's
  nothing to cancel).

The choice to inline Subscribe Monthly + Annual buttons (rather than
linking to a `/pricing` page) is dictated by the same constraint
documented in `Dashboard.tsx:425-434`: signed-in users get auto-routed
away from the landing page where Pricing lives, so an in-dashboard
checkout-launch is the only working path today.

## Scope (files allowed)

- src/components/dashboard/Dashboard.tsx
- plans/kiara/show-manage-billing-to-pilot.md

## Out of scope (files forbidden)

- src/components/billing/PilotCountdownBanner.tsx (banner copy unchanged;
  its single-CTA is fine for the banner surface where space is limited).
- src/hooks/usePortal.ts (no API change — pilot users use the existing
  `openPortal` helper unchanged).
- src/hooks/useCheckout.ts (no API change).
- src/hooks/useSubscription.ts (no shape change — `pilotStatus`,
  `pilotDaysRemaining`, `pilotExpiresAt` are all already exposed).
- supabase/** (no backend change — `stripe-portal` already works for
  customers without an active subscription).
- src/stripe-config.ts (catalog unchanged).
- src/App.tsx / routing (the `/pricing` routing bug for signed-in users
  is a separate followup; this PR works within the existing constraint).

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`) — Dashboard.tsx pilot branch only
- [ ] test (`src/**/__tests__/`)

Component-only change. No new hooks, no new state, no new handlers —
reuses `handleStartPlan('workspace_monthly')`, `handleStartPlan('workspace_annual')`,
and `handleManageBilling` which all already exist in the file.

## Mock data plan

None.

## Approved-by

`src/components/dashboard/Dashboard.tsx` is shared billing/dashboard
infra. Per CLAUDE.md, requesting 2 reviewers.

- ishika@piqclinical.com — reviewer (billing UI + subscription state)
- karl@piqclinical.com — reviewer (shared-infra second pair of eyes)

## Verification

- [ ] `npm run build` passes (TS strict) after the change.
- [ ] As a signed-in pilot user (active pilot, `pilot_expires_at` in the
  future), open Settings → Billing. Verify the panel shows:
    - Plan name + expiry + green/amber/rose chip (existing).
    - Description text mentioning "you can cancel any time."
    - Two Subscribe buttons side-by-side (sm+) / stacked (mobile).
    - Manage billing button matching the Workspace panel's visual style.
    - Helper text below describing what Manage billing offers.
- [ ] Click "Subscribe — $59 / month" → Stripe Checkout opens in
  subscription mode for `workspace_monthly`.
- [ ] Click "Subscribe — $599 / year" → Stripe Checkout opens in
  subscription mode for `workspace_annual`.
- [ ] Click "Manage billing" → Stripe Customer Portal opens. Confirm
  the portal shows the pilot receipt, payment method, and support
  contact (subscription section is naturally absent for pilots).
- [ ] As a signed-in *expired-pilot* user (`pilot_expires_at` in the
  past), open Settings → Billing. Verify the panel still renders with
  the rose chip, the description text says "Your Pilot has ended.
  To continue using PIQClinical, choose a subscription. You can cancel
  any time.", and both Subscribe buttons + Manage billing are still
  available.
- [ ] As a signed-in Workspace user, open Settings → Billing. Verify
  the Workspace panel is unchanged (sanity check that the pilot-branch
  edits didn't leak into the Workspace branch).
- [ ] As a signed-in no-plan user, open Settings → Billing. Verify the
  no-plan branch is unchanged.
