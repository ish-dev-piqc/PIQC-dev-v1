---
owner: kiara
feature: post-login-redirect-to-checkout
status: in-review
started: 2026-05-24
target_pr:
---

# Post-login redirect to checkout (Stripe Track D #11)

## Context

Today, an unauthenticated visitor who clicks any Pricing card CTA is sent to
the Login screen but the intended `priceId` is lost — after sign-in they land
on the dashboard and have to navigate back to `#pricing` and click again.
This closes the gap by persisting the intended checkout across the auth round
trip (including the magic-link email round trip, which lands in a possibly
fresh tab).

Approach: a tiny `localStorage`-backed helper holds `{ kind, savedAt }` with
a 15-minute TTL. `Pricing.tsx` writes it before bouncing the user to login;
on landing with a valid session it reads it, fires the existing
`launchCheckout` flow for that `PlanKind`, and clears it. `App.tsx` is
adjusted so that when a pending intent exists, the post-login redirect goes
to `landing` (scrolled to `#pricing`) instead of `dashboard`, so the
auto-resume on Pricing can run.

## Scope (files allowed)

- src/components/Pricing.tsx
- src/App.tsx
- src/lib/billing/pendingCheckout.ts
- src/lib/billing/pendingCheckout.test.ts
- .gitignore (added `vite.config.ts.timestamp-*.mjs` glob alongside the existing `vitest.config.ts.timestamp-*.mjs` entry)
- supabase/.temp/** (untrack CLI cache files that were accidentally committed; folder was already in `.gitignore` but the entries pre-dated the ignore rule)

## Out of scope (files forbidden)

- src/stripe-config.ts (no priceId or catalog change)
- src/hooks/useCheckout.ts (no API change)
- src/components/auth/Login.tsx (login UI unchanged; redirect-on-success is centralized in App.tsx)
- supabase/** **except** `supabase/.temp/**` (no schema, function, or migration changes in this PR; the `.temp/` cleanup is purely untracking metadata that should never have been committed)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [x] test (`src/**/__tests__/`) — colocated `*.test.ts`

## Mock data plan

None.

## Approved-by

Most files in Scope are shared infra / Kiara-owned per `docs/CODEOWNERS.md`:
- `src/components/Pricing.tsx` — landing UI, no specific mode owner
- `src/App.tsx` — shared infra; second reviewer required (tag on PR)
- `src/lib/billing/` — new directory under shared infra; second reviewer required (tag on PR)
- `.gitignore` — shared infra; review covered by the shared-infra reviewer above
- `supabase/.temp/**` — Roger's domain (`supabase/`); change is metadata-only (`git rm --cached`, no SQL or function impact). Tag @roger on the PR for sign-off.

## Verification

- [ ] Sign out. Click "Start Pilot" on landing → bounced to login.
- [ ] Sign in via password → land on Pricing (not Dashboard) and Stripe Checkout fires automatically for the Pilot price.
- [ ] Repeat with magic link (different tab) → same auto-resume on the tab that completes auth.
- [ ] Cancel Stripe Checkout and return → no auto-relaunch (pending cleared on first attempt).
- [ ] Wait >15 minutes between click and login → pending TTL expires, user lands on Dashboard as before.
- [ ] Click "Start Pilot" while already signed in → unchanged behavior (direct checkout, no pending write).
- [ ] `npm run build` (TS strict) and `npx vitest run src/lib/billing/pendingCheckout.test.ts` pass.
