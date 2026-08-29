---
owner: ish-dev-piqc
feature: vew-persist-rpc-fix
status: merged
merged: 2026-07-05
started: 2026-06-30
target_pr: #423
---

# Visit Prep — persist RPC no longer zeroes the whole batch (P0)

## Context

Some protocols (POLAR-M: 23 visits with full `procedures_structured`) ingested with **0 `visit_requirements`** → Visit Prep shows every visit with no per-visit detail; others (BLKR201) are fine. Confirmed root cause (investigated): `visit_requirements` has `UNIQUE (visit_template_id, ordinal)`, but `visit_execution_persist_parsed_workspace` identifies rows by **fingerprint** (not ordinal), assigns `ordinal` by payload index, and does **not** delete orphan rows before inserting — all in **one transaction with no per-row isolation**. On **re-ingest**, a churny SoA re-parse changes a visit's procedures → a new-fingerprint `INSERT` lands on an `ordinal` still held by an un-deleted orphan → unique violation → the whole payload rolls back → 0 rows, and `persistVisitExecutionWorkspaces` **swallows** the error (blank tab, no signal). First ingests never hit it; POLAR-M was re-ingested; BLKR201 stays stable (UPDATE-only path).

No currently-stored protocol is broken (footprint scan: BLKR201 166 reqs, CLR 155; POLAR-M deleted) — this fix is **preventive** + makes any future failure visible. No re-ingest needed.

## Scope (files allowed)

- supabase/migrations/20260708000000_vew_persist_rpc_fix.sql   (NEW)
- supabase/functions/_shared/ingestPipeline.ts

## Out of scope

- **Orphan-row deletion** — deliberately deferred by the RPC's own §7.1 (destroying human-reviewed rows on amendment is destructive). No-re-ingest makes orphan accumulation moot now; revisit with Sprint-4 review UI.
- Any other ingest/parse behavior; cohort logic (Slice B); footnotes.

## Architecture layers

- [x] migration (RPC) — `supabase/`
- [x] RPC / ingest (`supabase/functions/_shared/`)
- [ ] context / component
- [ ] test (RPC is PL/pgSQL — not vitest-runnable; verified via migration apply + constraint check + manual SQL repro; see Verification)

**DB schema change → TS type mirror:** N/A (dropping a constraint + adding a `visits_failed` count to the RPC return; no TS type consumes the RPC return shape structurally).

## Approved-by

- @rv61 (Roger) — `supabase/migrations/` + `supabase/functions/_shared/`.

## Fix

1. **Drop `UNIQUE (visit_template_id, ordinal)`** (`ALTER TABLE … DROP CONSTRAINT IF EXISTS visit_requirements_visit_template_id_ordinal_key`). `ordinal` is display order, not identity (the fingerprint is identity); ties sort fine. This removes the collision that aborts the transaction.
2. **Per-visit `BEGIN … EXCEPTION WHEN OTHERS`** in the RPC's visit loop → one bad visit can't zero the other 22; count `visits_failed` and add it to the return JSON + `RAISE WARNING` with `SQLERRM`/`SQLSTATE`.
3. **Surface the swallowed error** — in `persistVisitExecutionWorkspaces`, on `rpcError` (or `visits_failed > 0`) write a `protocol_visit_coverage` flag (same path as `unmatchedWithProcedures`) + `console.error` the `.code`/`.details`, so a persist failure is a visible banner, never a silent blank tab.

## Verification (no re-ingest)

- `supabase db push` applies cleanly; `\d visit_requirements` / `pg_constraint` shows the ordinal unique gone; the RPC + helpers still present.
- Manual SQL repro on a scratch template: insert a requirement at ordinal 3, call the RPC with a new-fingerprint proc also at ordinal 3 → **persists both** (no abort), returns `requirements_written > 0`.
- `npm run typecheck` clean; `/piqc-review` green.
- Existing protocols unaffected (BLKR201 still 166, CLR still 155).
