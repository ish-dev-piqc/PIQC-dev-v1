---
owner: ki-dev-piqc
feature: reports-xlsx-export
status: merged
merged: 2026-06-04
started: 2026-06-04
target_pr: #293
---

# Reports — XLSX export

## Context

ReportsTab today has two export paths:

- **CSV** — single visit list, useful for paste-into-portal flows.
- **PDF** — formatted full report with summary + protocol breakdown +
  deviation log.

Sites have asked for a single Excel workbook they can attach to
sponsor / monitor emails — multi-sheet (Summary, Visits,
Participants, Deviations) so the recipient can pivot / filter
without re-formatting.

## Design

### Dependency

Add `xlsx` (SheetJS Community Edition) — ~250 KB gzipped, MIT
licence, the de-facto JS library for this format.

### New module — `src/lib/site/reportsExport.ts`

Pure builder that takes the in-memory snapshots already passed to
ReportsTab and returns a `Blob` ready for download. No DOM or
download wiring lives here — the component handles the
`a.click()` boilerplate the way it does today for CSV.

```ts
buildReportWorkbook({
  scopeLabel: string;          // "PP06489" or "All protocols"
  generatedAt: string;         // ISO date
  stats: ReportStats;          // existing shape
  visits: SiteVisit[];
  participants: SiteParticipant[];
  protocolRows: ProtocolRow[]; // populated only for cross-protocol scope
}) → Blob
```

Sheets, in order:

1. **Summary** — Metric / Value rows (active participants, visit
   compliance, completed, missed, deviations, open deviations,
   upcoming).
2. **Visits** — Date, Participant, Protocol, Visit, Status,
   Deviation reason, Note.
3. **Participants** — ID, Status, Enrolled, Current study day,
   Next visit, Next visit date, Coordinator, Open deviations.
4. **Deviations** — Date, Participant, Protocol, Visit, Reason.
5. **By protocol** — only when scope is "all protocols". Same
   columns as the existing PDF per-protocol table.

Empty sheets are skipped (no point including "Deviations" when
there are none).

### UI

One new button on ReportsTab, next to "Export CSV" and
"Export PDF":

> [ Download XLSX ]

Uses the `Sheet` lucide icon to distinguish from the others.

## Scope (files allowed)

### New

- `src/lib/site/reportsExport.ts`
- `src/lib/site/__tests__/reportsExport.test.ts`
- `plans/kiara/reports-xlsx-export.md` — this file.

### Modified

- `src/components/dashboard/site/ReportsTab.tsx` — wire the
  button.
- `package.json` + `package-lock.json` — add `xlsx` dependency.

## Architecture layers touched

- [x] lib (pure builder)
- [x] component (button)

## Mock data plan

None. Test fixtures in the sibling test use small hand-crafted
inputs.

## Approved-by

- Shared infra (`package.json`) — needs Roger's nod since a new
  runtime dep ships to every user.

## Out of scope

- Streaming / paging — workbook is built in memory. At our scale
  (≤ a few thousand visits per protocol) memory pressure is
  negligible.
- Conditional formatting / charts — plain values only.
- Multi-protocol-batch download — one workbook per ReportsTab
  scope (active protocol or "all protocols").
- Custom column visibility — fixed schema per sheet.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Sibling tests pass — verify workbook has expected sheets, sheet
  ordering, and a sample row's cell values.
- Manual:
  - All-protocols scope → Download XLSX → opens in Excel with 5
    sheets (Summary, Visits, Participants, Deviations, By protocol).
  - Single-protocol scope → no "By protocol" sheet.
  - No deviations → no "Deviations" sheet.
