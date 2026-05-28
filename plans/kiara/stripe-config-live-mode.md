---
owner: kiara
feature: stripe-config-live-mode
status: in-review
started: 2026-05-28
target_pr:
---

# Swap stripe-config to live priceIds + productIds

## Context

The new business Stripe account has been moved out of sandbox/test mode.
All 5 live products + prices were created in Stripe live mode today, with
the required `metadata.kind` (and `metadata.pilot_days = 30` on the pilot)
set on each Price. The `src/stripe-config.ts` catalog still referenced
the test-mode IDs from yesterday's `stripe-config-new-account` PR, so
the production Pricing page + checkout flows would fail with
"No such price" on the live Supabase keys.

This PR swaps the 5 priceIds + 5 productIds in `stripe-config.ts` to the
live-mode equivalents. Catalog kinds, copy, feature lists, pricing
displays, and entitlement grants are unchanged — only the opaque Stripe IDs.

The Stripe-account-side and Supabase-secret-side migration steps were
done outside git (Stripe dashboard + `supabase secrets set`) and verified
end-to-end before this PR:

- All 5 live Prices have `metadata.kind` set correctly — verified via
  `GET /v1/prices/...` against the live API (the Stripe dashboard form
  was silently dropping metadata writes; CLI-based update via the live
  secret key was used as the workaround).
- `STRIPE_SECRET_KEY` rotated to the live `sk_live_...` and pushed to
  Supabase secrets.
- New live webhook endpoint created in Stripe live mode pointing at the
  same `stripe-webhook` function URL, subscribed to the same event set
  as the test endpoint plus `charge.dispute.created` and
  `invoice.payment_action_required`.
- `STRIPE_WEBHOOK_SECRET` rotated to the new live `whsec_...` and pushed
  to Supabase secrets.
- Customer Portal configured in live mode with Additional Protocol +
  Additional Seat Pack as quantity-editable (min 0, prorations on), so
  customers can cancel an add-on without canceling the base subscription.
- Branding (brand color, accent, foreground, business name) set in
  live mode.

## Scope (files allowed)

- src/stripe-config.ts
- plans/kiara/stripe-config-live-mode.md

## Out of scope (files forbidden)

- src/hooks/useCheckout.ts (no API change)
- src/hooks/usePortal.ts (no API change)
- src/hooks/useSubscription.ts (no shape change)
- src/components/billing/** (no UI change)
- supabase/** (backend already deployed; only secrets rotated, no code/migration)

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

`src/stripe-config.ts` is billing-critical infra. Per CLAUDE.md shared
infra rules, requesting 2 reviewers. Roger is included for visibility
since the swap is tied to live Supabase secret rotations he should be
aware of.

- ishika@piqclinical.com — reviewer (billing catalog + Stripe wiring oversight)
- roger@piqclinical.com — reviewer (Supabase secrets rotation companion)

## Verification

- [ ] `npm run build` passes (TS strict) after the swap.
- [ ] Deploy to production succeeds and serves the new IDs.
- [ ] On the deployed site, signed in with a real account, click "Start Pilot" → Stripe Checkout opens in live mode showing "Protocol Clarity Pilot" + $25.
- [ ] Pay with a real card (smoke test purchase, refunded after).
- [ ] Stripe live dashboard shows the $25 charge succeeded for the test customer.
- [ ] Live webhook endpoint shows `checkout.session.completed` delivered with 200.
- [ ] Supabase `stripe_customers` row created with `pilot_expires_at` populated 30 days out.
- [ ] Live Customer Portal opens from inside the app; cancel-subscription flow + cancellation reason survey + add-on quantity editor all render correctly.
- [ ] Smoke-test purchase refunded in the Stripe live dashboard.
