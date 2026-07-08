---
owner: ish-dev-piqc
feature: db-remediation
status: in-review
started: 2026-07-07
target_pr:
---

# DB remediation — anon corpus revoke + stage-gate column lock

## Context

The post-#449 audit (full report: `docs/remediation/2026-07-07-post-449-audit.md`, committed in this branch) confirmed two live DB-layer vulnerabilities: (1) the April-era anon read-all policies on `documents`/`chunks` plus anon-executable `hybrid_search` expose the whole protocol corpus to anyone with the public anon key; (2) the audit stage gate exists only inside the `audit_mode_advance_audit_stage` RPC while RLS lets the lead auditor UPDATE `current_stage` directly, so the GxP gate is bypassable via PostgREST. This branch fixes both at the DB layer and adds smoke coverage proving the holes are closed.

## Scope (files allowed)

- supabase/migrations/20260721000000_revoke_anon_corpus_read.sql (NEW)
- supabase/migrations/20260721000100_audit_mode_lock_current_stage_column.sql (NEW)
- supabase/migrations/20260721000200_sotr_pdf_path_fix_access_denied.sql (NEW — dead access-denied branch found by the extended smoke suite during verification; SOTR is mine)
- supabase/migrations/20260705000000_audit_mode_workflow_type.sql → 20260705000001 (RENAME ONLY, content untouched — version collides with visit_template_cohort_applicability and would fail `db push` on `schema_migrations_pkey`; see report §1)
- scripts/smoke-rpcs.sh
- docs/remediation/2026-07-07-post-449-audit.md (NEW)
- plans/ishika/db-remediation.md

## Out of scope (files forbidden)

- src/lib/audit/** and src/components/dashboard/audit/** — the frontend Result<T> hardening is specced in the handoff report for a separate PR (Karl's area)
- src/context/AuditContext.tsx — advanceStageError shipped in #458; no context change needed (RPC error hints/codes unchanged)
- src/types/audit/** — no type impact: all three migrations change policies/grants/function bodies only; no table, column, enum, or RPC-signature change
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

## Verification (done 2026-07-07, fresh local stack)

- [x] `supabase db reset` replays all 162 migrations cleanly — **required 3 local-only patches to pre-existing broken history + the collision rename; see report §6.1** (patches not committed; drift reconciliation is Roger's follow-up)
- [x] smoke-rpcs.sh 62/62: anon curl on `documents`/`chunks`/`hybrid_search` → denied (SEC-1..3; hybrid_search needed REVOKE FROM PUBLIC, not just anon); authenticated reads still work
- [x] smoke-rpcs.sh: authenticated PATCH `audits.current_stage` → 42501 (T9c); PATCH `audit_name` → 2xx (T9d); service-role PATCH → 2xx (T9e); RPC advance happy/gate paths unchanged (T9a/T9b)
- [x] Authenticated document reads verified via SOTR suite (T13–T29) — user JWT lists/reads own documents post-revoke
- [x] `tsc --noEmit` clean; vitest 1365/1365 green
