---
owner: ish-dev-piqc
feature: cohort-scope-binding
status: in-review
started: 2026-07-03
target_pr:
---

# Visit Prep — cohort-scope binding accuracy (Slice 3.1)

## Context

Per-visit `applies_to` mis-binds when the extracted cohort list is more *granular* than the SoA labels, so the Visit Prep cohort filter drops or orphans visits:

- **Granularity:** SoA heading/marker says `S4`, but the cohort list has `S4 Period 1` / `S4 Period 2` → the literal-token match (does the full label appear in the heading?) misses → the visit binds to nothing (orphan) instead of both periods.
- **Synonym:** the list has `CSF`, the SoA heading says `Cerebrospinal Fluid Cohort` → no token overlap → uncovered.
- **Reconcile false-pass:** a single shared-backbone visit (`applies_to = null`) set `covered_count = all`, so `reconcileCohorts` reported `consistent: true` even while the schedule referenced a cohort token (`S4`) that maps to **no** extracted cohort — the orphan was silently masked.

Fix binds correctly + makes the reconcile a real safety net. **No re-ingest** (current direction): the fix is verified by unit tests against real-protocol strings and takes effect on **future** ingests; existing protocols' stored `applies_to` is not backfilled until a later re-ingest (deferred, user's call). No DB/schema change — `soa_aliases` rides the in-memory extract only.

## Scope (files allowed)

- supabase/functions/_shared/soaGridParser.ts — `cohortsFromTableHeading` (alias ∪ label match + parent→period prefix expansion), `markerCohortScope` (resolve raw marker against the list), `deriveAppliesTo` + `assembleVisitsFromGrouping` (thread the alias map); new pure helper `leadingCohortToken` + `CohortAliasMap` type.
- supabase/functions/_shared/cohortExtraction.ts — `ExtractedCohort` += `soa_aliases`; `parseStudyCohorts` reads it; rewrite `reconcileCohorts` (per-cohort coverage + orphan-schedule-ref flag).
- supabase/functions/_shared/ingestPipeline.ts — `study_cohorts` extract schema += `soa_aliases` property + prompt guidance; build the label→aliases map and pass it to `assembleVisitsFromGrouping`.
- supabase/functions/_shared/__tests__/soaGridParser.test.ts — alias + prefix-expansion + marker-resolve + deriveAppliesTo cases.
- supabase/functions/_shared/__tests__/cohortExtraction.test.ts — `soa_aliases` parse + reconcile per-cohort/orphan cases.

## Out of scope

- The persist RPC / migration (Slice A, PR #399).
- Footnotes (Slice C/D); `parseStatedCohortCount` noise (Slice C).
- Any UI (`CohortDetailPanel`, selector) — the binding + reconcile shape is unchanged from the consumer's view; only accuracy improves.
- Persisting `soa_aliases` to `protocol_cohorts` — aliases are ingest-time-only (in-memory); no DB column, no migration.

## Architecture layers

- [x] adapter/parser (`supabase/functions/_shared/` — pure, vitest-tested)
- [x] RPC/ingest (`ingestPipeline.ts` — schema + wiring)
- [ ] migration — none (no DB change)
- [ ] context / component
- [x] test (vitest — pure parser + extraction logic)

**DB schema change → TS type mirror:** N/A — no migration. `ExtractedCohort.soa_aliases` is an in-memory TS interface, not a DB type.

## Approved-by

- @rv61 (Roger) — all files under `supabase/functions/_shared/`.

## Fix

1. **Alias-aware matching.** `study_cohorts` extract schema gains `soa_aliases: string[]` (the model states how each cohort appears in the SoA table: `CSF`→`["Cerebrospinal Fluid Cohort"]`). `cohortsFromTableHeading` matches on label ∪ aliases (bounded token). Aliases only ever resolve to a cohort already in the authoritative list — never invents one.
2. **Parent→period prefix expansion (deterministic).** A heading/marker naming a coarse parent token (`S4`) binds every granular label whose leading token is that parent (`S4 Period 1`, `S4 Period 2`). New pure helper `leadingCohortToken`. `markerCohortScope` resolves the raw restriction token (`[S4 only]` → `S4`) against the list via the same path instead of emitting the orphan `["S4"]`.
3. **Reconcile per-cohort.** Rewrite `reconcileCohorts`: keep the shared-backbone semantics for `covered_count` (a null-`applies_to` visit genuinely covers every cohort — dropping it entirely would over-flag clean shared schedules, i.e. Slice-C noise), but compute an **orphan-schedule-ref** flag *independently* of the backbone: any cohort token the schedule references that maps to no extracted cohort is surfaced ("schedule references cohort scope 'X' not in the extracted list"). That is the check the blanket backbone shortcut used to mask.

## Verification (no re-ingest)

- `supabase/functions/_shared/__tests__/soaGridParser.test.ts`: `S4` heading binds `S4 Period 1/2` (not orphaned); `Cerebrospinal Fluid Cohort` heading binds `CSF` via alias; `[S4 only]` marker resolves to both periods; a heading naming no cohort → `[]`; `S4` still ∌ `S40`/`S6`.
- `cohortExtraction.test.ts`: `parseStudyCohorts` reads/normalizes `soa_aliases`; `reconcileCohorts` flags an orphan schedule ref even WITH a shared backbone (the false-pass fix); a clean shared-backbone 3-arm design stays `consistent: true` (no over-flag).
- `npm run typecheck` clean; `npx vitest run …/__tests__/soaGridParser.test.ts …/__tests__/cohortExtraction.test.ts` green; `/piqc-review` green.
- Ingest-time fix → effective on future parses; existing `applies_to` not backfilled (no re-ingest, deferred).
