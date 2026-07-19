---
owner: sixonelabs-piqc
feature: Worksheet export — PDF-safe glyphs (WinAnsi)
status: merged
merged: 2026-07-19
started: 2026-07-19
target_pr: #518
---

# Worksheet export — PDF-safe glyphs

## Context

jsPDF's built-in helvetica is WinAnsi (CP1252)-encoded; glyphs outside that set silently
degrade to mojibake in the produced PDF. Verified 2026-07-19 on a rendered sample:
'⚠ Safety Critical' prints as '& Safety Critical', 'Reviewed ✓' prints as "Reviewed '",
and the open-items banner's '⚠' prints as '&'. A fourth instance found during intake: the
visit-window line uses a true minus sign (U+2212), which prints as '"'. Replace all four
with ASCII-safe markers, keeping the visual-flag intent — '!' is already this file's
print-safe flag convention (formatTiming, needs_review).

## Scope (files allowed)

- plans/sixonelabs-piqc/worksheet-export-pdf-safe-glyphs.md
- src/lib/visit-execution/visitExecutionExportApi.ts
- src/lib/visit-execution/__tests__/visitExecutionExportApi.test.ts

## Out of scope (files forbidden)

- src/components/dashboard/visit-execution/ExecutionItemClassificationBadge.tsx (browser UI — web fonts render ⚠ fine; this is a PDF-encoding fix only)
- supabase/**, src/types/**, everything else

## Architecture layers touched

lib (print-label constants, one banner glyph, window formatter), test. No migration, no
RPC, no adapter, no context, no component.

## Mock data plan

none

## Approved-by

- @ish-dev-piqc — owns src/lib/visit-execution/**; review tag on the PR.

## Verification

- [x] vitest: existing export suite green + new WinAnsi-safety tests (exact label shapes + all-ASCII sweep over both label maps)
- [x] `tsc --noEmit -p tsconfig.app.json` clean
- [x] Manual: export a worksheet with ≥1 safety-critical item, ≥1 reviewed item, ≥1 open item, and a −/+ window; confirm '! Safety Critical', 'Reviewed [x]', banner '!', and 'Day N · -X / +Y days' render without mojibake
