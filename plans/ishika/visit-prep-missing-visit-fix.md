---
owner: ish-dev-piqc
feature: visit-prep-missing-visit-fix
status: in-review
started: 2026-06-02
target_pr:
---

# Visit Prep — stop dropping visits with a non-numeric study_day

## Context

Some protocol visits (e.g. Visit 5 & 6) never appeared in Visit Prep. The ingest
template-build filter, persist loop, and cross-ref fan-out all gated visits on
`typeof study_day === "number"`, so a visit whose day Reducto returned as a string
("57", "Day 168 ± 7") or null was silently dropped from `protocol_visit_templates`
— while the Protocol/SOTR path (which coerces via `toNumber`) still showed it. This
adds a conservative `coerceStudyDay` helper and replaces the silent drop with a
logged warning. Carved off `main` as its own PR so it lands independently of the
larger in-flight `visits-polish` feature branch.

## Scope (files allowed)

- supabase/functions/_shared/studyDayCoerce.ts
- supabase/functions/_shared/__tests__/studyDayCoerce.test.ts
- supabase/functions/_shared/ingestPipeline.ts

## Out of scope (files forbidden)

- supabase/migrations/ — the separate ordering-fix migration has its own branch/PR (`visit-prep-order-fix`).
- src/components/dashboard/visit-execution/, src/lib/visit-execution/ — frontend (handled in `visits-polish`).
- The LLM schedule-completeness fast-follow — separate, deferred.

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [x] RPC / ingest (`supabase/functions/_shared/`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [x] test (`supabase/functions/_shared/__tests__/`)

## Mock data plan

none.

## Approved-by

- @rv61 (Roger) — `supabase/functions/_shared/` (ingest pipeline). Pure helper extraction + 3 guard-site swaps; no schema/RPC signature change.

## Verification

- [ ] `npx vitest run supabase/functions/_shared/__tests__/studyDayCoerce.test.ts` green (6 tests).
- [ ] `coerceStudyDay` recovers number / "57" / "Day 168 ± 7" / negatives; returns null for "Week 24", "30 days post last dose", etc.
- [ ] Template-build (step 5) and persist loop coerce identically so the `visit_name|study_day` lookup keys still line up.
- [ ] A visit with a non-numeric day no longer vanishes; truly-unrecoverable days log `visit_dropped_unparseable_study_day` instead of disappearing silently.
- [ ] Forward-looking: existing protocols need a re-ingest (edge-fn deploy) to backfill the visits previously dropped.
