---
owner: ish-dev-piqc
feature: visit-execution-visual-polish-v2
status: merged
merged: 2026-05-27
started: 2026-05-27
target_pr: #138
---

# VEW visual polish v2 — fresh, clear, intuitive

## Context

The earlier `feat/visit-execution-visual-polish` branch is stale (pre-Sprint-3) and flagged as
design-rethink-needed in memory `feedback_vew_cognitive_load_test.md`. This is the rethink, applied
to the current main state (Sprint 4b complete; Sprint 4c is in PR #137 review).

Goal per the cognitive-load test memory:

> Keep all compliance-required information. Improve the presentation so the surface feels
> deliberate — strong hierarchy, generous whitespace, restrained color, clear affordances —
> not "well-organized clinical PDF."

**Failure mode this prevents:** PIQC re-renders protocol complexity in card form with no
presentation gain, and the coordinator goes back to the protocol PDF.

## Scope (files allowed)

- `src/components/dashboard/visit-execution/VisitNavigator.tsx`
- `src/components/dashboard/visit-execution/VisitSnapshotCard.tsx`
- `src/components/dashboard/visit-execution/TimingBanner.tsx`
- `src/components/dashboard/visit-execution/ExecutionChecklist.tsx`
- `src/components/dashboard/visit-execution/ExecutionItemClassificationBadge.tsx`
- `src/components/dashboard/visit-execution/ExecutionReviewStatusBadge.tsx`
- `src/components/dashboard/visit-execution/TraceabilityDrawer.tsx`
- `src/components/dashboard/visit-execution/ExportPlaceholderButton.tsx`
- `plans/ishika/visit-execution-visual-polish-v2.md` (this file)

## Out of scope (files forbidden)

- `src/components/dashboard/visit-execution/VisitExecutionTab.tsx` — major #137 diff overlap
- `src/components/dashboard/visit-execution/RequirementTextDrawer.tsx` — refactored in #137
- `src/components/dashboard/visit-execution/CompletenessSignalsPanel.tsx` — new in #137; polish in followup
- `src/components/dashboard/visit-execution/EditLogDrawer.tsx` — new in #137; polish in followup
- All `src/lib/visit-execution/*` — no API/data changes
- All `src/types/visit-execution/*` — no type changes
- All `supabase/migrations/*` — no schema changes
- The original `feat/visit-execution-visual-polish` branch — superseded; do not resurrect
- Any cross-mode (`audit/`, `sotr/`) files — mode isolation

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (presentational changes only — no prop shape changes that would ripple to VisitExecutionTab)
- [ ] test

## Mock data plan

None. All mock fixtures keep current values; only presentation changes.

## Approved-by

None — all scoped files are Ishika-owned per `docs/CODEOWNERS.md`.

## Verification

- [ ] `npm run typecheck` clean
- [ ] `npm run build` clean
- [ ] `npm test` — existing tests pass (no presentational tests yet for these surfaces)
- [ ] Visual diff against `main` in dev server (mock-mode on) on both light and dark themes:
  - Navigator chip count per row drops without losing signal
  - Snapshot card no longer reads "report-y"
  - Timing banner is one cohesive surface, not stacked
  - Classification + review-status badges only color the high-signal states
  - Phase headers feel like section titles, not chip rows
  - Drift hint + conditional callout share a visual language
- [ ] `piqc-review` clean

## Specific levers (deliberate — must read `feedback_vew_cognitive_load_test.md` before relitigating)

### Lever A — color discipline
- Today: 7 distinct chip palettes across classification + review_status + navigator + snapshot. Every chip a different tone makes nothing pop.
- Polish: only `safety_critical`, `primary_endpoint`, `needs_review`, `reviewed` earn color. Everything else uses muted text + uppercase tracking.

### Lever B — typography hierarchy
- Today: heavy `text-[10px] uppercase tracking-wider` labels in every micro-position. They all compete for the same hierarchy slot.
- Polish: reserve uppercase-tiny for true labels (section captions); use plain text for inline metadata.

### Lever C — Snapshot card stat row
- Today: "12 requirements · 4 reviewed" inline with optional amendment — feels like a footer caption.
- Polish: Linear-style stat grid (3 cells: total / reviewed / open). Each cell has a label + value pair.

### Lever D — Timing banner consolidation
- Today: two stacked banners (window + safety) plus a footer caption. Three visual weights compete.
- Polish: single banner with optional safety sub-row.

### Lever E — Navigator chip diet
- Today: up to 5 chips per visit row at 9px text.
- Polish: chip-cap of 3 + an overflow "+N" pill OR a single "critical" dot for rare-but-loud safety_critical. Reviewed/total remains a text counter (not a chip).

### Lever F — Phase header weight
- Today: phase header is `text-sm font-semibold`, same as item label.
- Polish: phase header earns a bolder treatment — larger, slightly looser tracking, with the reviewed-count counter pinned right.

### Lever G — Row drift hint + conditional chip alignment
- Today: drift hint chip uses neutral gray; conditional chip uses amber. Different visual languages on the same row.
- Polish: align both to the same chip shape + size. Tone differs by semantic (drift = neutral; conditional = amber), but they share rounded-md + px + text-size.

### Lever H — Export button primary style
- Today: ExportPlaceholderButton has its own button styling.
- Polish: match the canonical primary style used in `RequirementTextDrawer` save + `CompletenessSignalsPanel` Add (post-Sprint-4c).
