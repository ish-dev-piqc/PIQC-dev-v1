---
owner: ish-dev-piqc
feature: db-remediation
status: active
started: 2026-07-07
target_pr:
---

# DB remediation — anon corpus revoke + stage-gate column lock

## Context

The post-#449 audit (full report: `docs/remediation/2026-07-07-post-449-audit.md`, committed in this branch) confirmed two live DB-layer vulnerabilities: (1) the April-era anon read-all policies on `documents`/`chunks` plus anon-executable `hybrid_search` expose the whole protocol corpus to anyone with the public anon key; (2) the audit stage gate exists only inside the `audit_mode_advance_audit_stage` RPC while RLS lets the lead auditor UPDATE `current_stage` directly, so the GxP gate is bypassable via PostgREST. This branch fixes both at the DB layer and adds smoke coverage proving the holes are closed.

## Scope (files allowed)

- supabase/migrations/20260721000000_revoke_anon_corpus_read.sql (NEW)
- supabase/migrations/20260721000100_audit_mode_lock_current_stage_column.sql (NEW)
- scripts/smoke-rpcs.sh
- docs/remediation/2026-07-07-post-449-audit.md (NEW)
- plans/ishika/db-remediation.md

## Out of scope (files forbidden)

- src/lib/audit/** and src/components/dashboard/audit/** — the frontend Result<T> hardening is specced in the handoff report for a separate PR (Karl's area)
- src/context/AuditContext.tsx — advanceStageError shipped in #458; no context change needed (RPC error hints/codes unchanged)
- src/types/audit/** — no type impact: both migrations change policies/grants/function bodies only; no table, column, enum, or RPC-signature change
- supabase/functions/** — edge functions are deployed as-is (stale-deploy problem is ops, not code)

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`.sql` — `audit_mode_advance_audit_stage` recreated SECURITY DEFINER, body otherwise identical)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [x] test (`scripts/smoke-rpcs.sh` — RPC/RLS smoke additions)

## Mock data plan

none

## Approved-by

- @rv61 (Roger) — for both `supabase/migrations/*.sql` files (all of `supabase/` is Roger's). Tag on PR.

## Verification

- [ ] `supabase db reset` replays all migrations + seed cleanly
- [ ] smoke-rpcs.sh: anon curl on `documents`/`chunks`/`hybrid_search` → permission denied; authenticated member read still works
- [ ] smoke-rpcs.sh: authenticated PATCH `audits.current_stage` → 42501; PATCH `audit_name` → 2xx; service-role PATCH → 2xx; RPC advance happy/gate paths unchanged (T9a/T9b)
- [ ] Logged-in Knowledge Base still lists the user's documents (scoped policy, not broken)
- [ ] `npm run typecheck` + `vitest` green (no TS surface touched — CI parity)
