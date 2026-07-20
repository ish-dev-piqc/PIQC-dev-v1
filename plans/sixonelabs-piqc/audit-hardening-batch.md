---
owner: sixonelabs-piqc
feature: Audit hardening batch — seed-fn lockdown + timing-safe webhook secret (audit D2-2 + EDG-R1-3)
status: active
started: 2026-07-20
target_pr:
---

# Audit hardening batch (D2-2 + EDG-R1-3)

## Context

Two small confirmed findings from the Fable whole-codebase audit (`plans/fable/main-quality-audit-2026-07.md`), batched exactly as its owner-routed roadmap grouped them:

- **D2-2** — `seed_audit_mock_data` (20260429120000) is SECURITY DEFINER with no caller check and no explicit grants → under default function privileges any authenticated/anon API caller can execute a definer-privileged dev seeder. Inert in prod today only because its INSERTs trip a later NOT NULL constraint — a future schema change could silently re-arm it.
- **EDG-R1-3** — `reducto-webhook` compares its shared secret with `!==` (early-exit), leaking byte-position timing. The function is `verify_jwt=false`, so this compare is its entire auth.

## Scope (files allowed)

- supabase/migrations/20260731000000_lock_down_seed_audit_mock_data.sql
- supabase/functions/reducto-webhook/index.ts
- plans/sixonelabs-piqc/audit-hardening-batch.md

## Out of scope (files forbidden)

- 20260429120000_seed_audit_mock_data.sql (append-only; also NOT dropping the function — see decision below)
- **MAC-1 (`audit_mode_get_stage_readout` ISA readout) — seen and deliberately excluded.** Roger documented this exact deferral as B6 in 20260721000100 ("zero frontend callers … fail-safe (can_advance FALSE) … belongs to the future ISA workspace feature"); component grep confirms zero UI callers. Overriding a dated owner-signed deferral doesn't belong in a hardening batch.
- scripts/smoke-rpcs.sh — unchanged; it only references the seeded UUIDs, never calls the RPC.
- All other edge functions and the ingest pipeline (separate lane).

## Architecture layers touched

- migration (privilege DDL only — no schema change), edge function. No RPC-body, adapter, context, or component changes.

## Mock data plan

none

## Approved-by

- Roger — owns `supabase/` (both files). Entire batch is his lane.

## Design decisions

- **Revoke, don't drop, the seeder.** The audit's one-liner said drop; but the function is how a fresh dev environment gets the audit fixtures `scripts/smoke-rpcs.sh` depends on. Privilege-scoping (REVOKE from PUBLIC/anon/authenticated, GRANT to service_role) closes the entire API-facing hole while keeping the ops tool.
- **Hash-then-compare for the webhook secret.** SHA-256 both sides via `crypto.subtle` (already in the runtime — zero new imports), then a full-width XOR fold. Early-exit timing on digest bytes reveals nothing about the secret; the fold keeps even that constant-time.

## Verification

- `vitest run` green (no client code touched; suite guards against accidental fallout).
- Migration is privilege-only DDL — signature `seed_audit_mock_data(UUID, TEXT)` matches the live definition (verified against 20260429120000; no later redefinitions).
- Post-deploy smoke (dev team):
  1. As an authenticated user: `SELECT seed_audit_mock_data('<uuid>');` → permission denied (was: NOT NULL error, i.e. it executed).
  2. `supabase functions deploy reducto-webhook`, then a Reducto delivery with the correct `?token=` → 200-path unchanged; wrong token → 403.
- **Timestamp merge-monotonic:** 20260731000000 sorts after current max (20260730000000).

## Deploy step (dev-team-owned)

`supabase db push` (queues with the two already-pending migrations: 20260729 B1 RLS + 20260730 readiness gates) **and** `supabase functions deploy reducto-webhook`. No TS type impact — no `src/types/` change (migration is privilege DDL only).
