---
owner: kiara
feature: canceled-sub-and-discount-display
status: merged
merged: 2026-05-27
started: 2026-05-25
target_pr: #157
---

# Canceled-sub no-plan state + subscription discount display

## Context

Two related Settings → Billing fixes bundled into one PR because they both
touch the same panel logic and ship together for a coherent post-launch UX.

**(1) Canceled subscriptions still showed the Workspace UI.** After Stripe
fully cancels a subscription (status='canceled', fires
`customer.subscription.deleted`), the panel kept rendering the Workspace
"Manage Billing" UI. That's because `useSubscription` derives `kind` from
the persisted `price_id`, which doesn't change when status flips. The user
was stranded with no way to start a new plan from within the app.

Fix: require `hasActiveSub` (status `active` or `trialing`) alongside the
kind check. Canceled users correctly fall through to the no-plan branch
and see the three Start Pilot / Workspace / Annual buttons.

Edge cases preserved:

- `cancel_at_period_end = true` but `status = 'active'` (user clicked
  cancel but the period hasn't ended yet) — still shows Workspace panel
  because hasActiveSub is true. They still have access; UI is right.
- `status = 'past_due'` — hasActiveSub is false. Falls to no-plan buttons.
- Pilot users — unchanged (their lifecycle is encoded in `pilotStatus`).

**(2) Subscription-level discounts aren't visible.** When a customer
accepts a retention coupon (e.g., "20% off your next 3 months" in the
Stripe Portal cancel flow), Stripe applies it as a subscription-level
discount. Their next invoice reflects the discounted amount — but our
Settings → Billing panel still shows the un-discounted base + add-on
total. The discount is invisible until they get a Stripe receipt email,
which causes "wait what am I being charged" support tickets.

Fix: capture the discount from Stripe and surface it in the panel.

- New columns on `stripe_subscriptions`: `discount_percent_off INT` (e.g.
  20 for 20%) and `discount_end TIMESTAMPTZ` (when the discount expires,
  null = forever).
- Webhook reads `subscription.discount.coupon.percent_off` and
  `subscription.discount.end` on every `customer.subscription.created` /
  `.updated` event, persists to the new columns.
- `useSubscription` adds `discountPercentOff: number | null` and
  `discountEnd: string | null` to the Subscription shape.
- Dashboard.tsx Settings → Billing Workspace panel renders a line under
  the renews date when a discount is active: e.g.
  "20% off through Aug 27, 2026" or "20% off (no end date)".

Out of scope here: amount-based discounts (`coupon.amount_off`) and
multiple stacked discounts. Stripe Coupons support those but they're
rare for SaaS retention offers; the percent-off case covers what we
configured today. If we add amount-off offers later, extend the schema
+ display logic.

## Scope (files allowed)

- src/components/dashboard/Dashboard.tsx
- src/hooks/useSubscription.ts
- supabase/migrations/20260527000000_subscription_discount_columns.sql
- supabase/functions/stripe-webhook/index.ts

## Out of scope (files forbidden)

- src/lib/entitlements.ts (no entitlement-math change; discount is display-only)
- src/components/billing/** (no shared-infra component change)
- src/stripe-config.ts (no catalog change)
- supabase/functions/stripe-checkout/** (no checkout API change)
- supabase/functions/stripe-portal/** (no portal API change)

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`supabase/functions/` or `.sql`) — webhook handler change
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

DB schema change → see "Database / migrations" verification in piqc-review.
No `src/types/<domain>/` updates needed because billing types are inline
in `useSubscription.ts`.

## Mock data plan

None.

## Approved-by

Cross-owner PR per `docs/CODEOWNERS.md`:

- `src/components/dashboard/Dashboard.tsx` — no strict owner; request a second reviewer
- `src/hooks/useSubscription.ts` — no strict owner
- `supabase/migrations/**` — @rv61 (Roger) owns supabase/; tag him
- `supabase/functions/stripe-webhook/**` — @rv61 (Roger) owns supabase/; tag him

Reviewers to tag on PR:

- roger@piqclinical.com — required for `supabase/migrations/` + `supabase/functions/stripe-webhook/`
- ishika@piqclinical.com — second reviewer (dashboard shell + useSubscription shape)
- karl@piqclinical.com — second reviewer (shared-infra eyes)

## Verification

- [ ] Sign in as a user whose subscription was just canceled in Stripe (status=canceled). Navigate to Settings → Billing → panel shows the no-plan state (three Start buttons).
- [ ] Sign in as a user with `cancel_at_period_end = true` but `status = 'active'` → still shows Workspace UI with Manage Billing button.
- [ ] Active Workspace user with no discount → panel renders normally, no discount line.
- [ ] Active Workspace user with a retention coupon applied → panel shows the plan name, renews date, AND a new "20% off through `<date>`" line beneath it.
- [ ] Same user after the discount end date passes → panel reverts to the no-discount display on next webhook event.
- [ ] SQL: confirm `stripe_subscriptions.discount_percent_off` and `.discount_end` populate from webhook for a discounted subscription, and read as NULL for non-discounted ones.
- [ ] `npm run build` passes (TS strict).
- [ ] `supabase db push` migration applies cleanly with no errors.
