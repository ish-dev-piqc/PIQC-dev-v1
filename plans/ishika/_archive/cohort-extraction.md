---
owner: ish-dev-piqc
feature: cohort-extraction
status: merged
merged: 2026-06-29
started: 2026-06-28
target_pr: #383
---

# Visit Prep — cohort extraction + RAG↔Visit-Prep consistency (Slice 3)

## Context

The Ask tab correctly reports **6 cohorts (S1–S6)** for BLKR201; Visit Prep shows only **S4**. Root cause: the 6-cohort
structure lives in the protocol synopsis / cohort-definition prose — which the Ask tab reads via RAG over the `chunks`
table — but ingest **never structurally extracts cohorts** (the extract schema has no cohorts/arms field). Visit Prep
derives cohorts *only* from explicit `[X only]` SoA-header markers (Slice 2), so it caught just `S4`. This is a missing
extraction, not a UI bug. This slice adds the authoritative protocol-level cohort list, binds each visit's cohort scope
from its source SoA table heading (the stable, general signal — not BLKR201-specific), surfaces all cohorts + per-cohort
dose in Visit Prep, and adds a RAG↔structured reconciliation gate that **flags divergence for review instead of hiding
it**. Generalized + evidence-driven: two guarantees — (a) all cohorts appear or it's flagged (never silently fewer);
(b) no requirement leaks across cohorts. Builds on Slices 1–2 (#379, #381).

## Scope (files allowed)

- supabase/functions/_shared/soaGridParser.ts
- supabase/functions/_shared/cohortExtraction.ts   (NEW — pure study_cohorts parse + RAG↔schedule reconcile; vitest-importable, since ingestPipeline can't be)
- supabase/functions/_shared/ingestPipeline.ts
- supabase/migrations/20260706000000_protocol_cohorts.sql   (NEW)
- src/types/visit-execution/index.ts
- src/lib/visit-execution/visitExecutionApi.ts
- src/components/dashboard/visit-execution/VisitExecutionTab.tsx
- src/components/dashboard/visit-execution/CohortFilterBar.tsx
- src/components/dashboard/visit-execution/CohortDetailPanel.tsx   (NEW — per-cohort dose/description)
- supabase/functions/_shared/__tests__/soaGridParser.test.ts
- supabase/functions/_shared/__tests__/cohortExtraction.test.ts   (NEW)
- src/lib/visit-execution/__tests__/visitExecutionApi.test.ts

## Out of scope (files forbidden)

- supabase/migrations/20260705000000_visit_template_cohort_applicability.sql — merged; append-only (new migration only).
- src/lib/sotr/, src/components/dashboard/sotr/ — SOTR untouched.
- The RAG/Ask pipeline (`supabase/functions/dashboard-chat`, `hybrid_search`) — we READ the same `chunks` source, we
  don't modify the Ask pipeline.
- The full v2 compound-predicate AST (cohort × cycle × segment), local-first object model, amendment diff, CRPEE
  resolver — deferred (P1–P3). Un-resolvable scope surfaces as a review flag, never silent mis-scoping.

## Architecture layers touched

- [x] migration  (`protocol_cohorts` + RLS)
- [x] RPC / ingest (`supabase/functions/_shared/`)
- [x] adapter (`soaGridParser.ts` cohort-scope binding — pure)
- [ ] context
- [x] component (`visit-execution/` cohort selector + dose panel)
- [x] test

**DB schema change → TS type mirror:** `protocol_cohorts` (migration) ↔ `ProtocolCohort` in
`src/types/visit-execution/index.ts`. In scope, mirrored.

## Mock data plan

none.

## Approved-by

- @rv61 (Roger) — `supabase/functions/_shared/` (soaGridParser + ingestPipeline) and `supabase/migrations/`.
- `src/types/visit-execution/`, `src/lib/visit-execution/`, `src/components/dashboard/visit-execution/` — Ishika owns directly.

## Verification

- **Unit (vitest, no key) — generality tested with BOTH fixtures:**
  - `cohortsFromTableHeading` — `"…Cohorts S1, S2, S3, S4 … S6"` → `[S1..S6]`; `"MAD Cohorts"`→MAD; `"CSF"`→CSF; generic heading → `[]`.
  - **Shared fixture (BLKR201-like):** one heading lists S1–S6 → every visit `applies_to` = all 6; the `[S4 Only]` D4 → `["S4"]`. No leakage, all 6 covered.
  - **Divergent fixture:** separate per-cohort tables + a `Cohorts 3–6 only` footnote → each visit bound to its cohort(s); assert a C1-only requirement is **NOT** shown under C2 (no leakage).
  - count-anchored enumeration parser; `study_cohorts` JSON → rows; evidence gate (no evidence → flag); reconciliation diff; `fetchProtocolCohorts` Result<T>; non-cohort protocol → empty list (no selector).
- **Guarantee tests:** (a) under-count — detail resolves 4 of 6 → all 6 still listed + 2 flagged (never silently fewer); (b) no-leakage — divergent fixture never shows a cohort a requirement isn't bound to.
- `npm run typecheck` clean; `/piqc-review` green.
- **Live (deploy + re-ingest, gated — checkpoint before this step):** BLKR201 → `protocol_cohorts` = S1–S6 + dose + citations; 6-chip selector; count **equals Ask**. ASN008/CLR → no cohort UI (no regression).

## Non-regression

Additive: new table + new extract field. Protocols with no extracted cohorts → empty `protocol_cohorts` → no cohort UI
(identical to today). **Visit counts / ordering / classification unchanged** — cohort-scope binding only sets each visit's
`applies_to` (additive metadata) from its source table heading; it does NOT change which visits exist, their order, or
their procedures. Slice-1/2 `applies_to` markers untouched; the selector now *also* reads `protocol_cohorts`.
Evidence-gated: a cohort / cohort-scope shows only with supporting evidence (heading enumeration, footnote, or citation);
uncertain → flagged, never invented.
