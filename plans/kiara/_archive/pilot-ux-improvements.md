---
owner: kiara
feature: pilot-ux-improvements
status: merged
merged: 2026-05-27
started: 2026-05-25
target_pr: #151
---

# Pilot UX improvements — block double-purchase + banner visibility

## Context

Two small follow-ups discovered during the fresh-Stripe-account smoke test:

1. **Pilot can be purchased twice.** Today, a signed-in Pilot user who
   clicks "Start Pilot" on the pricing page is taken straight to Stripe
   Checkout and charged another $25, which silently overwrites
   `pilot_expires_at` to "now + 30 days" from the second purchase. The
   first purchase's expiry is lost. This is confusing for real customers
   ("did I pay again? did anything change?") and a refund vector. The
   Workspace plans already have an equivalent guard
   (`if (hasActiveSub) onViewChange('dashboard')`). Add the same guard
   for Pilot so an active pilot user's CTA navigates to the dashboard
   instead of opening Checkout.

2. **PilotCountdownBanner blends into the page background in its active
   state.** Current tone uses 8% opacity background + 20% opacity border
   on the brand blue, which on the light-mode `bg-[#f5f7fa]` page is
   barely distinguishable. Goal is for an active-pilot user to notice
   the countdown without it being alarming (alarming = expiring_soon and
   expired tones, which stay amber and rose respectively). Bump opacity
   and border weight on the active state so the banner reads as a clear
   in-app notification.

## Scope (files allowed)

- src/components/Pricing.tsx
- src/components/billing/PilotCountdownBanner.tsx

## Out of scope (files forbidden)

- src/hooks/useCheckout.ts (no API change)
- src/lib/entitlements.ts (no helper change; we just import `pilotStatus`)
- src/components/dashboard/Dashboard.tsx (Settings → Billing pilot panel is unchanged)
- src/stripe-config.ts (no catalog change)
- supabase/** (frontend only)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

Pure UI/UX work — no data layer change. Visual verification only.

## Mock data plan

None.

## Approved-by

- `src/components/Pricing.tsx` — landing UI, no specific mode owner
- `src/components/billing/PilotCountdownBanner.tsx` — shared infra per `docs/CODEOWNERS.md` (`src/components/billing/`); requires 2 reviewers

Reviewers tagged on PR:

- ishika@piqclinical.com — required reviewer for `src/components/billing/`
- karl@piqclinical.com — second reviewer for shared-infra changes

## Verification

- [ ] Sign in as a Pilot user. Navigate to the landing page pricing section. The "Start Pilot" CTA's label should read "Go to dashboard" instead of "Start Pilot".
- [ ] Click the CTA → navigates to dashboard, NOT to Stripe Checkout. No second $25 charge is created.
- [ ] Sign in as a Workspace user. The Pilot CTA still reads "Start Pilot" (Workspace users could in theory buy a Pilot, though the entitlement logic doesn't currently grant them anything extra — this is a separate product decision; we don't block Workspace → Pilot here).
- [ ] Sign in as a no-plan user. The Pilot CTA reads "Start Pilot" → opens Stripe Checkout normally.
- [ ] As a Pilot user, the dashboard PilotCountdownBanner is now visibly distinct from the page background — bumped opacity / border so the banner reads as a clear notification, not a barely-tinted strip.
- [ ] Expiring-soon (amber) and expired (rose) tones are unchanged — those still escalate.
- [ ] `npm run build` passes (TS strict).
