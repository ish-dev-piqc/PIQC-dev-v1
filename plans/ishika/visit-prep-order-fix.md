---
owner: ish-dev-piqc
feature: visit-prep-order-fix
status: in-review
started: 2026-06-02
target_pr:
---

# Visit Prep — visit ordering fix (workspace RPC)

## Context

Visits in the Visit Prep (Visit Execution Workspace) tab render in arbitrary order. Root cause:
`visit_execution_get_workspace` aggregates visits with
`json_agg(workspace_row ORDER BY (workspace_row->>'study_day_sort')::INTEGER)`, but `study_day_sort`
is a subquery **column alias**, not a key inside the `workspace_row` JSON object (the day lives at
`snapshot.study_day`). So `workspace_row->>'study_day_sort'` is `NULL` for every row → `ORDER BY NULL`
→ Postgres returns visits in arbitrary order (the item-level sort on `->>'phase_order'` is fine — that
key *does* exist in its JSON). Shipped as a standalone migration so it lands independently of the larger
`visits-polish` rework, which does not touch the sort.

## Scope (files allowed)

- supabase/migrations/20260624000000_visit_execution_get_workspace_order_fix.sql

## Out of scope (files forbidden)

- supabase/functions/_shared/ingestPipeline.ts — the separate missing-visit (non-numeric `study_day`) fix; handled on its own branch `ishika/visit-prep-missing-visit-fix` (carved off main). Not part of this PR.
- src/components/dashboard/visit-execution/VisitExecutionTab.tsx — the stale `// set by adapter sort` comment (line ~245) is corrected inside visits-polish (in-flight +118 lines there); avoided here to keep this PR conflict-free.
- All previously-merged migrations (append-only — never edited).

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`.sql` — `CREATE OR REPLACE FUNCTION visit_execution_get_workspace`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

**DB schema change → TS type mirror:** N/A — **no type impact.** This is a `CREATE OR REPLACE`
of an existing RPC; the JSON return shape is byte-identical to v3 (ordering only), so no
`src/types/visit-execution/` change is needed.

## Mock data plan

none.

## Approved-by

- @rv61 (Roger) — `supabase/migrations/`. `CREATE OR REPLACE` of an existing RPC: sort-only body change, same signature, no schema change. Re-states `SECURITY DEFINER` + `STABLE` + `SET search_path = public` so it does **not** regress the perf fix from `20260620000000` (a bare replace would reset to `SECURITY INVOKER` and reintroduce the ~6s statement-timeout on large protocols).

## Verification

- [ ] `supabase db push` applies `20260624000000` cleanly.
- [ ] Visit Prep navigator lists visits by `study_day` ascending (Screening / negative days first), stable for same-day visits (tiebreak on visit_template_id).
- [ ] Default-selected visit is the lowest `study_day` (VisitExecutionTab selects `r.data[0]`).
- [ ] Function is still `SECURITY DEFINER` — `\df+ visit_execution_get_workspace` shows "definer"; large-protocol load stays sub-100ms (no timeout regression).
- [ ] `npm run typecheck` clean (SQL-only change; no TS impact).
