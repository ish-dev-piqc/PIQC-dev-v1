---
owner: ish-dev-piqc
feature: Visit-definition integration — codify ProtocolVisitEvent + close accuracy gaps
status: in-review
started: 2026-06-22
target_pr: 379
approved_by: "@rv61"   # supabase/functions/_shared/* is Roger's area
---

# Visit-definition integration (Slice 1) — codify + close accuracy gaps, no regression

## Context
An external spec (deep-research report + developer handoff) redefines a "visit" as a **ProtocolVisitEvent**: any participant-specific protocol execution event anchored to a timepoint/interval/milestone/cycle-day/window/trigger that requires site action. Grounding it against PIQC showed ~70% of the spec's schema already exists (classification + origin enums, conditional/timing rule tables, traceability, review/confidence layer, name-level aggregate expansion). This slice **codifies** the definition into the LLM grouping rules + tests and closes a few **deterministic** accuracy gaps — no new schema, no migration. Multi-source visit discovery + recurrence/applicability/amendment work are deferred (see design plan).

Full design + frozen regression baseline: `~/.claude/plans/ok-so-now-lets-wiggly-comet.md` (approved).

## Scope (files allowed)
- `supabase/functions/_shared/ingestPipeline.ts` — `SOA_GROUPING_SYSTEM` (codify definition + drop NonVisitOperationalItems); broaden `assignClassification` conservatively; wire ambiguity flags into existing `protocol_visit_coverage.missing[]` / completeness signals.
- `supabase/functions/_shared/soaGridParser.ts` — `deriveStudyDay` + `assembleVisitsFromGrouping`: monotonic approximate `study_day` (dateless → last-real-day+1) so study_day-sorted UI orders dateless visits after real ones.
- `supabase/functions/_shared/visitScheduleRules.ts` — expand aggregate **column headers** (Weeks 2,4,6,8 / Dosing 3-6 / Cycles 2-6 Day 1 / comma-lists); reuse `expandAggregateVisitRow`.
- `supabase/functions/_shared/__tests__/soaGridParser.test.ts` (+ a visitScheduleRules test) — golden + unit coverage.
- `plans/ishika/visit-definition-integration.md`

### Slice 2 — cohort applicability (same branch)
- `supabase/functions/_shared/soaGridParser.ts` — `cohortOnlyRestriction` + `applies_to` in `assembleVisitsFromGrouping` (**reliable-markers-only**: explicit `[X only]` → `[X]`, else null). Section-table-derived MAD/SAD/CSF tagging was prototyped then dropped — Reducto's table segmentation is non-deterministic, so it mislabeled shared visits (a wrongly-hidden visit is a clinical risk). Accurate cohort separation is deferred to the body-text cohort-definition slice. `ScheduleOfEventsItem.applies_to`.
- `supabase/functions/_shared/ingestPipeline.ts` — write `applies_to` on the `protocol_visit_templates` upsert (alongside `column_order`).
- `supabase/migrations/20260705000000_visit_template_cohort_applicability.sql` (NEW) — `ADD COLUMN applies_to TEXT[]` + `CREATE OR REPLACE visit_execution_get_workspace` (v7, returns `applies_to`). Persist RPC untouched.
- `src/types/visit-execution/index.ts` — `VisitSnapshot.applies_to`.
- `src/lib/visit-execution/visitExecutionAdapter.ts` — thin-adapter `applies_to: null`.
- `src/components/dashboard/visit-execution/{CohortBadge,CohortFilterBar}.tsx` (NEW) + `VisitNavigator.tsx`, `VisitSnapshotCard.tsx`, `VisitExecutionTab.tsx` — filter + badge.

## Out of scope (must NOT touch)
- The persist RPC body (applies_to is written at template upsert, not via persist UPDATE); multi-source body-text visit discovery; RecurringVisitRule; procedure-level cohort applicability; separate per-cohort schedules; amendment-diffing; VisionLM provenance; renaming the core object.
- Any Site/Audit mode files (note: `ProtocolVisitTemplate` type in `src/lib/site/types` is read but NOT modified); other SOTR adapters; auth/billing/entitlements.
- `documents/*.pdf` + root `*.mjs` scaffolding (never committed; PHI + throwaway).

## Architecture layers touched
Slice 1: adapter (soaGridParser, visitScheduleRules), pipeline/edge-fn (ingestPipeline), test. Slice 2 adds: migration + RPC (get v7), type-mirror (`VisitSnapshot.applies_to` mirrors the new `protocol_visit_templates.applies_to` column), adapter passthrough, UI (filter bar + badge).

## Mock data plan
None.

## Approved-by
`@rv61` (Roger) — `supabase/functions/_shared/*` ownership.

## Verification
- Unit/golden: `deriveStudyDay` monotonic ordering; column-aggregate expansion (finite expands, open-ended preserved+flagged); `assignClassification` precision (zero new false positives on the 6 baseline protocols); NonVisitOperationalItem drop. Full vitest suite green.
- Offline harness over cached parses: regression bar identical except intentional re-baselines (RVW101 aggregate counts; classifier safety/endpoint counts).
- Live (needs fresh OpenAI key): redeploy 4 ingest fns → clear DB → re-ingest BLKR201 + RVW101 + UCARTCS1A → confirm counts, study_day order chronological w/ follow-ups last, improved safety/endpoint flags, ambiguity visible in CoverageBanner/CompletenessSignalsPanel.
- Slice 2 (cohort): unit tests for `cohortLabelFromSection` (cohort headings → labels; generic SoA → null), `cohortOnlyRestriction` ([S4 Only] → S4), and `assembleVisitsFromGrouping.applies_to` (single-table → all null = no regression; multi-cohort → correct tags). tsc clean. Live: re-ingest BLKR201 → cohort filter (All/SAD/MAD/CSF) appears, filtering reconstructs each cohort's schedule, S4-only visit shows a badge; ASN008 (single-schedule) shows NO cohort UI.
