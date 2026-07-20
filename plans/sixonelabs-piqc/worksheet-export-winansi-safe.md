---
owner: sixonelabs-piqc
feature: worksheet-export-winansi-safe
status: in-review
started: 2026-07-19
target_pr:
---

# Worksheet export — WinAnsi-safe data-driven text

## Context

PR #518 fixed the four hardcoded non-WinAnsi glyphs (⚠ / ✓ / U+2212) in the worksheet PDF, but data-driven text still reaches jsPDF's WinAnsi (CP1252)-only helvetica unsanitized: divergence quotes and brief-line text from the S1.5 reading section, item labels / descriptions / conditions / source fields, timing labels, role hints, protocol section names, visit purpose, visit/protocol names, and amendment versions. Clinical protocol text routinely carries ≤ ≥ µ ×, which print as mojibake exactly like the fixed labels did. This slice adds a pure `winAnsiSafe(text)` transliteration helper at the PDF text boundary and applies it wherever packet/reading strings reach `doc.text` / autotable cells.

## Scope (files allowed)

- `src/lib/visit-execution/visitExecutionExportApi.ts`
- `src/lib/visit-execution/__tests__/visitExecutionExportApi.test.ts`

## Out of scope (files forbidden)

- `src/lib/deliverables/deliverablesExportApi.ts` — same jsPDF-helvetica exposure confirmed; noted in the PR for a follow-up slice, not expanded here
- `src/lib/sotr/exportApi.ts` — checked: CSV exporter, no jsPDF, no exposure
- `src/types/divergence/`, `src/types/visit-execution/` — label maps stay as-is (already pure ASCII; regression-tested)
- `supabase/` — render-layer only; no schema, no type impact

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

Plus the lib/API layer (`visitExecutionExportApi.ts`) — a pure render-boundary helper; no Result-shape, RPC, or component changes.

## Mock data plan

none

## Approved-by

- @ish-dev-piqc — for `src/lib/visit-execution/**` (codeowner)

Overlap note: `plans/ishika/demo-protocols-swap.md` (status: active) also lists `src/lib/visit-execution/visitExecutionExportApi.ts` in its Scope. This slice only wraps existing call sites at the render boundary and adds one helper — flagged here and in the PR so merges can be sequenced.

## Decision debt

- Root-cause fix is embedding a Unicode font (jsPDF `addFileToVFS`/`addFont`) instead of transliterating. Deferred: adds a large font asset + licensing question for a marginal glyph set. Trigger for revisiting: a real protocol whose worksheet renders `?` fallbacks for glyphs outside the transliteration map.
- `src/lib/deliverables/deliverablesExportApi.ts` has the same exposure — follow-up slice, not bundled here (one feature per PR).

## Verification

- [x] `tsc --noEmit -p tsconfig.app.json` clean (the real typecheck; bare `tsc --noEmit` is a no-op in this repo)
- [x] `vitest run` — full suite 1559/1559 green (124 files), incl. the new `winAnsiSafe` unit tests, reading-section sanitization tests, and the existing ASCII label-map regressions
- [ ] Manual: export a worksheet whose brief/divergence text contains ≤ ≥ µ → prints `<=` `>=` `u`; CP1252 typography (— – · § ± “ ” …) intact; DRAFT chrome unchanged
