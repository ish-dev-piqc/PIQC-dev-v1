---
owner: kiara
feature: checkout-loading-screen
status: active
started: 2026-05-25
target_pr:
---

# Shared full-screen "Opening checkout…" loading state

## Context

After signing in from a Pricing CTA, the app briefly renders the full
landing page (Hero / ValueProps / Pricing / FAQ / Contact / Footer) before
Pricing's auto-resume effect mounts and fires `createCheckoutSession`, which
finally redirects to Stripe. The user sees marketing content flash in for a
second — confusing and looks like an error.

Other Stripe-redirect entry points (Manage billing, Pilot countdown
banner's upgrade, Settings → Billing upgrade-from-pilot, signed-in Pricing
CTAs) all have inline loading states on their own buttons but no
unified, prominent loading affordance. This makes them feel different from
each other and from the auto-resume path.

This plan introduces a single shared full-screen "Opening checkout…" /
"Opening billing portal…" loading page used by every Stripe redirect entry
point in the app, plus moves the auto-resume logic out of `Pricing.tsx`
into a dedicated `CheckoutResumer` component so App.tsx no longer has to
render the landing page during the transition.

## Scope (files allowed)

- src/context/CheckoutRedirectContext.tsx (new)
- src/components/billing/RedirectingToCheckout.tsx (new)
- src/components/billing/CheckoutResumer.tsx (new)
- src/App.tsx
- src/components/Pricing.tsx
- src/components/dashboard/Dashboard.tsx
- src/components/billing/PilotCountdownBanner.tsx

## Out of scope (files forbidden)

- src/hooks/useCheckout.ts (no API change — still owns the fetch + redirect)
- src/hooks/usePortal.ts (no API change)
- src/stripe-config.ts (no catalog change)
- src/lib/billing/pendingCheckout.ts (no helper shape change)
- src/components/billing/EntitlementGate.tsx (dormant component; will pick
  up the context when it's first rendered, but we don't modify it here)
- supabase/** (no backend impact — pure frontend UX)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [x] context (`src/context/`)
- [x] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

Pure UI / state work. No new Api or Adapter. Existing pendingCheckout test
continues to cover the localStorage helper.

## Mock data plan

None.

## Approved-by

Multiple shared-infra files in Scope. Per `docs/CODEOWNERS.md`:

- `src/context/` — owned by @ish-dev-piqc + @ki-dev-piqc (2 reviewers required)
- `src/components/billing/` — owned by @ish-dev-piqc + @ki-dev-piqc (2 reviewers required)
- `src/App.tsx` — no strict CODEOWNERS rule; treat as shared infra, request a second reviewer
- `src/components/Pricing.tsx` — landing UI, no specific mode owner
- `src/components/dashboard/Dashboard.tsx` — dashboard shell, no strict owner; request a second reviewer

Tag on PR:

- @ish-dev-piqc (Ishika) — required reviewer for `src/context/` and `src/components/billing/`
- @karl-dev-piqc (Karl) — optional second reviewer for shared-infra changes

## Verification

- [ ] Sign out on the deployed site, click "Start Pilot" → land on login → sign in → see a clean full-screen "Opening checkout…" loading page (no landing flash) → Stripe Checkout opens.
- [ ] Already signed in, click any Pricing CTA → same full-screen "Opening checkout…" appears immediately on click → Stripe Checkout opens.
- [ ] Click "Manage billing" in Settings → Billing → full-screen "Opening billing portal…" → Stripe Customer Portal opens.
- [ ] Click upgrade button on PilotCountdownBanner → full-screen "Opening checkout…" → Stripe Checkout opens.
- [ ] Click upgrade-to-Workspace button in Settings → Billing (Pilot user) → full-screen "Opening checkout…" → Stripe Checkout opens.
- [ ] If a Stripe call fails (e.g., disconnect network mid-call), loading screen clears and the originating component shows an inline error. App is interactive again, not stuck on the loading page.
- [ ] `npm run build` (TS strict) passes.
