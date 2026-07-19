---
owner: sixonelabs-piqc
feature: Narrative-first worksheet export — the reading travels with the deliverable (S1.5)
status: merged
merged: 2026-07-19
started: 2026-07-19
target_pr: #514
---

# Narrative-first worksheet export (S1.5 — deterministic)

## Context

PR #512 made the Visit Prep *workspace* open on a reading (brief + sequence + watch-outs). The
*worksheet* — the PDF that travels to the binder and to other site staff — still carries none of it:
no gates up front, no cohort scope, and no divergence warning. A printed worksheet that doesn't say
"the protocol gives two windows for this visit" loses the arc's most valuable signal at the exact
moment it matters (paper in hand, PDF closed). Per the workspace/worksheet doctrine the deliverable
must carry the reading. Zero backend, zero LLM: the workspace's already-computed `briefLines` and
`visitDivergences` are passed INTO the export — computed once, rendered twice, single source of
truth (also sidesteps the export packet's trimmed snapshot, which lacks `applies_to`).

## Scope (files allowed)

- plans/sixonelabs-piqc/narrative-first-worksheet-export.md
- src/lib/visit-execution/visitExecutionExportApi.ts
- src/lib/visit-execution/__tests__/visitExecutionExportApi.test.ts
- src/lib/visit-execution/__tests__/visitBriefModel.test.ts  (fixture honesty fix: use the real DivergenceRecord shape instead of a cast — no behavior change)
- src/components/dashboard/visit-execution/ExportWorksheetButton.tsx
- src/components/dashboard/visit-execution/VisitExecutionTab.tsx

## Out of scope (files forbidden)

- supabase/** (the export RPC is untouched — the reading arrives client-side)
- src/lib/visit-execution/visitBriefModel.ts (unchanged; the PDF consumes its output)
- src/types/** , src/lib/divergence/**, everything else

## Architecture layers touched

component, lib (pure section model + PDF render), test. No migration, no RPC.

## Mock data plan

None (mock-mode export already synthesizes a packet; the reading props flow the same way).

## Approved-by

- @ish-dev-piqc (owns the VEW tree) — review tag on the PR.

## Design

1. `WorksheetReading = { briefLines, divergences }` — optional 4th/3rd params on
   `downloadVisitWorksheet` / `buildVisitWorksheetPdf`; omitted → PDF byte-identical behavior to
   today (all existing tests stay green unchanged).
2. `buildWorksheetReadingSection(reading)` — pure, exported, heavily tested: claims = brief lines
   minus `orient` (purpose already on page 1) minus `clock` (the window line already on page 1)
   minus `watchout` (superseded by the full divergence block); each claim carries its joined ref
   addresses. Divergences = open + raised_with_sponsor only, capped at 5 with an honest "+N more"
   line; each block renders BOTH readings (quote, verbatim-vs-as-extracted honesty label, §/page)
   and the status — never a verdict.
3. PDF layout (page 1, between the purpose block and the stats line): claim bullets (9pt, address
   in gray), then the divergence box (amber fill/border, same family as the open-items banner) —
   title "The protocol gives two readings — resolve before scheduling". Page-break guarded.
4. Role-filtered exports keep the CANONICAL reading (the brief is the visit's truth; the
   "Filtered view" subtitle already flags the narrowed table below).
5. `ExportWorksheetButton` gains optional `reading` prop; `VisitExecutionTab` passes the
   already-memoized `briefLines` + `visitDivergences`.

## Verification

- `node_modules/.bin/tsc --noEmit -p tsconfig.app.json` clean.
- `vitest run src/lib/visit-execution` green — all existing export tests unchanged; new tests for
  buildWorksheetReadingSection (claim selection, ref joining, divergence honesty labels, status
  filtering, cap line) + no-throw render tests with a reading attached.
- Post-merge dev-team pass: export a visit with an open divergence → PDF page 1 shows gates +
  the amber two-readings box; export with none → PDF unchanged from today.
