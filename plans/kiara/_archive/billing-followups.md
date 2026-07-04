---
owner: kiara
feature: billing-followups
status: merged
merged: 2026-05-25
started: 2026-05-25
target_pr: #113
---

# Billing follow-ups (post-PR #109)

## Context

Three small follow-ups discovered after the post-login-redirect-to-checkout
work merged:

1. **App.tsx redirect-loop hotfix.** The pending-checkout effect in
   `App.tsx` was bouncing users straight back to dashboard on its second
   run (when `view` changed to `'landing'`, the fall-through branch
   `if (view === 'login' || view === 'landing') setView('dashboard')` undid
   the redirect before `Pricing.tsx`'s auto-resume effect had a chance to
   mount). User observed it as "the splash page glitching in" — landing
   flashed briefly, then dashboard. Fix is a one-liner: return early
   whenever `pendingCheckout` exists.

2. **PilotCountdownBanner is built but never rendered.** A user who buys
   the Pilot has no in-app reminder that their 30 days is counting down
   and no in-app CTA to upgrade. The component (`src/components/billing/PilotCountdownBanner.tsx`)
   self-hides when `pilotStatus === 'none'`, so dropping it unconditionally
   near the top of `Dashboard.tsx` is safe.

3. **Settings → Billing empty state is unhelpful for pilot users.** Today
   pilot users see "Manage billing" (which opens a Stripe Customer Portal
   that mostly can't manage anything — pilots are one-time Orders, not
   Subscriptions). Truly-no-plan users see the same row but with planName
   "No plan". Replace with a kind-aware panel: pilot users see expiry +
   upgrade CTA; no-plan users see "No active plan" + link to pricing;
   workspace users see today's UI.

## Scope (files allowed)

- src/App.tsx
- src/components/dashboard/Dashboard.tsx

## Out of scope (files forbidden)

- src/components/billing/PilotCountdownBanner.tsx (rendering as-is; no internal change)
- src/components/billing/EntitlementGate.tsx (still dormant by design)
- src/hooks/useSubscription.ts (no shape change)
- src/lib/billing/** (no helper change)
- supabase/** (no backend impact)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

UI-only change. Pure visual / wiring work — no new Api / Adapter / RPC, no
state-shape change. Manual verification per the steps below; no new unit
tests added (the existing pendingCheckout test still covers the helper that
App.tsx consumes).

## Mock data plan

None.

## Approved-by

Per `docs/CODEOWNERS.md`, neither file in Scope has a strict codeowner rule —
`src/App.tsx` and `src/components/dashboard/Dashboard.tsx` are top-level
shell files that fall outside the explicit ownership table. As a courtesy
for widely-used infrastructure, request two reviewers on the PR:

- @ish-dev-piqc (Ishika) — second reviewer, dashboard shell + App routing
- @karl-dev-piqc (Karl) — second reviewer, dashboard shell + App routing

Files in Scope:

- `src/App.tsx` — no strict CODEOWNERS rule; treat as shared infra
- `src/components/dashboard/Dashboard.tsx` — no strict CODEOWNERS rule; treat as shared infra

## Verification

- [ ] On the deployed site signed-out, click "Start Pilot" → land on login → sign in → land on pricing section → Stripe Checkout opens automatically (no detour through dashboard).
- [ ] Dashboard now shows the PilotCountdownBanner for pilot users (sign in as a pilot user, verify "N days left on your pilot" appears near the top of the dashboard); banner is absent for workspace users and unauth.
- [ ] Settings → Billing for a Pilot user shows expiry date + upgrade-to-Workspace CTA, not the existing "Manage billing" button.
- [ ] Settings → Billing for a Workspace user is unchanged (planName + renews + Manage billing).
- [ ] Settings → Billing for a no-plan user shows "No active plan" + link to landing pricing section.
- [ ] `npm run build` (TS strict) passes.
