---
owner: ish-dev-piqc
feature: visit-execution-sprint-5-5-cleanup
status: merged
merged: 2026-05-27
started: 2026-05-27
target_pr: #143
---

# VEW Sprint 5.5 — cleanup PR (watermark soften + doc sync)

## Context

Two small post-Sprint-5 cleanup items bundled into one PR so they merge as a single review pass.

### 1. Soften the DRAFT watermark (founder feedback post-#141)

The Sprint 5 watermark on exported worksheets reads heavy enough to risk adding stress to the site coordinator opening their own freshly-built deliverable. Compliance signal must stay visible, but it should be **ambient context, not anxiety-inducing alarm**.

Three compounding levers tune the visual weight down:

| Lever | Before (Sprint 5) | After |
|---|---|---|
| Opacity | 0.12 | **0.06** (half — barely there) |
| Color (RGB) | (120,120,120) gray-500 | **(180,180,180)** gray-400 — washes further at low opacity |
| Font size | 110pt bold | **90pt bold** — diagonal still legible, less page-eating |

Belt-and-suspenders compliance signals on every page (don't need the watermark to carry the load alone):
- Corner header `PIQC drafted · Visit worksheet · DRAFT`
- Footer disclaimer (italic, every page)
- Footer `Generated YYYY-MM-DD HH:MM UTC` server-stamp
- Open-items amber banner on page 1 when `needs_review_count > 0`

### 2. Doc sync — parser-integration.md §8.1 `parser_confidence` → `confidence_state`

The Sprint 3 design doc (PR #124) committed `parser_confidence` as the column name. Implementation in PR #127 + #131 diverged to `confidence_state` to match the existing SOTR enum on `protocol_extracted_items`. Doc has been out-of-sync ever since (logged as decision-debt in `project_visit_execution_workspace.md`).

Four occurrences in `docs/visit-execution/parser-integration.md`:
- Line ~258 (prose): "Marks the affected `protocol_visit_templates` row's `parser_confidence = 'needs_review'`"
- Line ~328 (SQL block): `ADD COLUMN parser_confidence confidence_state;`
- Line ~432 (TS interface): `parser_confidence: VisitConfidenceState | null;`
- Line ~504 (mitigation table): `parser_confidence='high'`

All four become `confidence_state` (the column name + the TS field name; the type stays `confidence_state` / `VisitConfidenceState`).

## Scope (files allowed)

- `src/lib/visit-execution/visitExecutionExportApi.ts` — only the watermark block in `buildVisitWorksheetPdf`
- `docs/visit-execution/parser-integration.md` — four `parser_confidence` → `confidence_state` replacements
- `plans/ishika/visit-execution-sprint-5-5-cleanup.md` (this file)

## Out of scope (files forbidden)

- All other PDF rendering logic (open-items banner, autotables, traceability appendix, footer disclaimer)
- Test file changes — existing build-without-throwing tests cover the new watermark values without modification
- Any migration, API, types, or component file outside the watermark block
- Any other VEW doc / behaviour change

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (PDF builder — single block)
- [ ] test

## Mock data plan

None.

## Approved-by

None — all in Ishika's ownership.

## Verification

- [ ] `npm run typecheck` clean
- [ ] `npm run build` clean
- [ ] `npm test` — existing tests pass (no behavioral assertions about watermark visual weight)
- [ ] Visual diff: open the mock-mode exported PDF. Watermark should be discernible-on-purpose but not compete with body text for attention.
- [ ] Doc skim: §8.1 / §9.3 / §6.2 / §11 of parser-integration.md no longer mention `parser_confidence`
- [ ] `piqc-review` clean
