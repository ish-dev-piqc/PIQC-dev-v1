---
owner: kiara
feature: stripe-config-new-account
status: merged
merged: 2026-05-27
started: 2026-05-25
target_pr: #149
---

# Refresh Stripe priceIds + productIds for new test account

## Context

The Stripe test sandbox account previously wired to `stripe-config.ts` was
deleted (developer account replaced with proper team access to the business
account). All 5 priceIds + 5 productIds in the catalog now reference IDs
that don't exist anymore, so every Pricing CTA + the Pilot/Workspace upgrade
flows would fail with "No such price."

This PR swaps the IDs to the freshly-created products on the new business
Stripe account. Catalog kinds, copy, feature lists, pricing displays, and
entitlement grants are unchanged — only the opaque Stripe IDs.

The metadata fix lessons from earlier today have been applied during product
creation: each new Price has `kind` (and Pilot also has `pilot_days = 30`)
metadata set so the webhook can correctly identify base vs add-on items.

## Scope (files allowed)

- src/stripe-config.ts

## Out of scope (files forbidden)

- src/hooks/useCheckout.ts (no API change)
- src/hooks/usePortal.ts (no API change)
- src/hooks/useSubscription.ts (no shape change)
- src/components/billing/** (no UI change)
- supabase/** (backend already deployed; only secrets get rotated, no code/migration)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

Single config file swap. No new logic. No type impact.

## Mock data plan

None.

## Approved-by

`src/stripe-config.ts` lives at the root of `src/` and has no strict
CODEOWNERS rule. Treat as billing-critical infra and request a second
reviewer for visibility.

- ishika@piqclinical.com — reviewer (billing catalog + Stripe wiring oversight)
- karl@piqclinical.com — reviewer (shared-infra second pair of eyes)

## Verification

- [ ] `npm run build` passes (TS strict) after the swap.
- [ ] On the deployed site, sign out, click "Start Pilot" → land on login → sign in → Stripe Checkout opens showing "Protocol Clarity Pilot" + $25 (NOT "No such price" or 400 error).
- [ ] Pay with `4242 4242 4242 4242` → redirect back to app root, no 404.
- [ ] Dashboard shows PilotCountdownBanner with "30 days left on your pilot".
- [ ] Settings → Billing shows the Pilot panel with the new expiry date + upgrade-to-Workspace CTA.
- [ ] SQL on `stripe_customers`: `pilot_expires_at` populated for the new customer record.
- [ ] Confirmed `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` were rotated to the new account's values (Phase 4 of the runbook).
- [ ] Old orphaned `stripe_customers` / `stripe_subscriptions` / `stripe_orders` rows from the deleted Stripe account were cleared (Phase 5 of the runbook).
