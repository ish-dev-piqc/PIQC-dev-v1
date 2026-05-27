---
owner: kiara
feature: inline-plan-choices-no-plan-state
status: merged
merged: 2026-05-27
started: 2026-05-25
target_pr: #155
---

# Inline plan choices in Settings → Billing for no-plan users

## Context

The Settings → Billing panel for a user with no active plan currently shows
a "View pricing" button. That button is broken — it navigates to
`/#pricing`, but `App.tsx` auto-routes signed-in users away from the
landing page to the dashboard, so the Pricing component never renders and
the hash anchor has nothing to scroll to. As a result the click does
nothing visible.

For comparison, "Manage billing" works fine because it leaves the SPA
entirely (jumps to `billing.stripe.com`); App.tsx's view routing never
gets a chance to interfere. We want the no-plan state to behave the same
way: clicking a plan button immediately opens Stripe Checkout.

Solution: replace "View pricing" with three direct-launch buttons (Pilot,
Workspace monthly, Workspace annual) that each call `createCheckoutSession`
for their respective priceId. Same pattern as the existing
`handleUpgradeFromPilot` already in this file. No App.tsx changes; no
landing page involved.

Add-ons (Protocol, Seats) are out of scope here — they require an active
subscription and don't apply to a no-plan user. Enterprise is also out of
scope — its CTA is a scroll-to-contact anchor that has the same landing-
page-only issue as `#pricing`; the right fix for enterprise inquiries from
inside the dashboard is a separate Contact link, future work.

## Scope (files allowed)

- src/components/dashboard/Dashboard.tsx

## Out of scope (files forbidden)

- src/components/Pricing.tsx (no changes; Pricing remains the landing surface)
- src/App.tsx (no routing change)
- src/components/billing/** (no shared-infra component change)
- src/hooks/useCheckout.ts (no API change — reusing existing hook)
- src/stripe-config.ts (no catalog change)
- supabase/** (no backend impact)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

Pure UI work in one component. Reuses existing checkout flow.

## Mock data plan

None.

## Approved-by

`src/components/dashboard/Dashboard.tsx` has no strict CODEOWNERS rule. As
a courtesy for the shared dashboard shell, request a second reviewer.

- ishika@piqclinical.com — second reviewer (dashboard shell + billing surface)
- karl@piqclinical.com — second reviewer (shared-infra eyes)

## Verification

- [ ] Sign in as a user with no active subscription. Navigate to Settings → Billing.
- [ ] The panel shows three buttons: "Start Pilot — $25 / 30 days", "Start Workspace — $59 / month", "Switch to Annual — $599 / year".
- [ ] Click "Start Workspace" → "Opening checkout…" loading screen → Stripe Checkout opens at $59/mo for "Founding Site Workspace".
- [ ] Click "Start Pilot" (sign out and back to no-plan first, or use a different test user) → Stripe Checkout opens at $25 for "Protocol Clarity Pilot".
- [ ] Click "Switch to Annual" → Stripe Checkout opens at $599/yr for "Founding Site Annual".
- [ ] If a checkout call fails (network down etc.), the loading screen clears and an inline error appears below the buttons. App is interactive again.
- [ ] After successful purchase, redirect back lands user at app root, dashboard updates to show the new plan panel (Workspace or Pilot, depending on which was bought).
- [ ] `npm run build` passes (TS strict).
