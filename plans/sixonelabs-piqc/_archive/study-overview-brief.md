---
owner: sixonelabs-piqc
feature: Study overview brief — the reading pattern, one level up (S1.6, deterministic)
status: merged
started: 2026-07-19
target_pr: 516
merged: 2026-07-19
---

# Study overview brief (S1.6 — deterministic)

## Context

The narrative-first arc (#512, #514) makes a VISIT open on a reading. Opening a PROTOCOL still
doesn't: a coordinator lands on the first visit with zero study-level orientation — the original
critique ("make using a protocol easier") one level up. This slice adds a selectable **Study
overview** node above the visit list: the study's shape on one screen — orient line, the visit arc
(every visit, day + window + markers, click-through), cohorts with dose regimens, and the
protocol-wide open-divergence panel. All deterministic, all from data VisitExecutionTab already
loads (workspaces / protocolCohorts / divergences). **Deliberately unobtrusive:** the default
landing stays first-visit; validation (per the published kit) decides whether this view earns a
bigger role.

## Scope (files allowed)

- plans/sixonelabs-piqc/study-overview-brief.md
- src/lib/visit-execution/studyBriefModel.ts
- src/lib/visit-execution/__tests__/studyBriefModel.test.ts
- src/components/dashboard/visit-execution/StudyOverviewPanel.tsx
- src/components/dashboard/visit-execution/VisitNavigator.tsx
- src/components/dashboard/visit-execution/VisitExecutionTab.tsx

## Out of scope (files forbidden)

- supabase/** (zero backend), src/lib/divergence/**, src/types/**, the export pipeline,
  ExecutionChecklist / VisitBriefBlock / VisitSequenceBlock, everything else.

## Architecture layers touched

component, pure model (lib), test.

## Mock data plan

None.

## Approved-by

- @ish-dev-piqc (VEW tree) — review tag on the PR.

## Design

1. `studyBriefModel.ts` (pure): `buildStudyBrief(workspaces, cohorts, divergences)` →
   `{ orient, arc, cohorts, openDivergenceCount }`. Orient = derived sentence (visit count, day
   span, cohort count, dosing-visit count — no composition, no LLM). Arc = one entry per visit
   (id, name, dayLabel, windowLabel, isDosing, appliesTo, needs-attention markers) sorted by
   study_day. Cohort entries pair `protocol_cohorts` rows with per-cohort visit counts.
   Divergence count = open + raised only (the settled are history).
2. `StudyOverviewPanel.tsx`: orient line ("PIQC drafted" NOT claimed — this is derived, labeled
   "Derived from the parsed schedule") → the arc as a compact clickable list (click = onSelectVisit)
   → cohort cards (label, dose regimen, description, visit count, source page) → the existing
   `DivergencePanel` fed the FULL protocol list (the visit view filters; the study view doesn't).
3. `VisitNavigator`: optional pinned "Study overview" node above the visit list (renders only when
   `onSelectStudy` provided — backward compatible).
4. `VisitExecutionTab`: local `STUDY_VIEW_ID` sentinel in the existing `selectedId` state; the
   right pane branches to `StudyOverviewPanel`; default selection unchanged (first visit).
   Selecting a visit from the arc routes through the same `setSelectedId`.

## Verification

- `node_modules/.bin/tsc --noEmit -p tsconfig.app.json` clean; `vitest run src/lib/visit-execution` green.
- studyBriefModel tests: orient line assembly (spans, counts, singular/plural), arc ordering +
  window labels + marker derivation, per-cohort visit counting (null applies_to = all), divergence
  status filtering, empty-protocol degradation.
- Post-merge dev-team pass: open a cohort protocol → Study overview node → arc click-through lands
  on the right visit; divergence panel shows the protocol-wide set.
