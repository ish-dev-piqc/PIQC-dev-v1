---
owner: sixonelabs-piqc
feature: stripe-webhook verify_jwt=false (audit high D1)
status: merged
started: 2026-07-20
target_pr: 527
merged: 2026-07-20
---

# stripe-webhook gateway auth — audit high D1

## Context

The Fable quality audit (`plans/fable/main-quality-audit-2026-07.md`, finding D1) found `supabase/config.toml` has no `[functions.stripe-webhook]` entry, so the function inherits the default `verify_jwt = true`. Stripe can only present its `Stripe-Signature` header — it structurally cannot mint a Supabase JWT — so the gateway 401s every delivery before the handler's (correct) signature check runs. Subscription / cancellation / pilot-expiry sync is therefore either silently dead in production right now, or depends on a dashboard override the next config-driven deploy would drop. Fix: add the entry with `verify_jwt = false`, exactly mirroring the six functions that already self-authenticate (`reducto-webhook` is the closest analog — a server-to-server webhook that verifies a secret instead of a JWT).

## Scope (files allowed)

- supabase/config.toml
- plans/sixonelabs-piqc/stripe-webhook-verify-jwt.md

## Out of scope (files forbidden)

- supabase/functions/stripe-webhook/index.ts — the handler's signature verification is already correct; no code change needed.
- supabase/functions/contact/ — the audit noted `contact` also inherits verify_jwt=true, but that is CORRECT for it: contact is invoked with the anon-key JWT from the frontend and has no signature check of its own. Flipping it to false would expose the contact endpoint to unauthenticated spam. Deliberately untouched — tracked as a separate lower-priority note, not folded into this billing fix.
- Any migration, RPC, adapter, context, or component.

## Architecture layers touched

- config (supabase/config.toml only) — no migration, no code.

## Mock data plan

none

## Approved-by

- Roger — owns `supabase/` and platform config. Entirely his lane; flagged for his review-tag.

## Verification

- **Fix present:** `config.toml` now has `[functions.stripe-webhook]` with `verify_jwt = false`, matching the reducto-webhook pattern.
- **Safe:** the handler verifies `stripe-signature` against `STRIPE_WEBHOOK_SECRET` via `stripe.webhooks.constructEventAsync` and returns 400 on a missing/invalid signature (`supabase/functions/stripe-webhook/index.ts`) — so the endpoint being publicly reachable at the gateway does not weaken auth; Stripe's signature is the auth.
- **Post-deploy smoke (dev team):** after `supabase functions deploy stripe-webhook` (or a config-driven redeploy), a Stripe test event (e.g. `stripe trigger customer.subscription.deleted`) reaches the handler and returns 200 instead of a gateway 401. Confirm against Stripe → Developers → Webhooks → delivery logs that recent real deliveries are no longer 401. **If deliveries were already succeeding, a dashboard override was masking this — this entry makes it durable in config.**

## Deploy step (dev-team-owned)

Config change — takes effect on the next `supabase functions deploy` for stripe-webhook (or a full config apply). No migration, no TS type impact.
