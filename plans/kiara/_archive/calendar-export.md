---
owner: ki-dev-piqc
feature: calendar-export
status: merged
merged: 2026-06-07
started: 2026-06-04
target_pr: #303
---

# Calendar export — .ics download

## Context

Site coordinators ask their schedules from PIQC to land in Outlook /
Google Calendar so they don't have to reconcile two surfaces. We
already render the data — this PR just emits an `.ics` for any
visit set currently scoped on screen.

## Design

### Pure builder

`src/lib/site/calendarExport.ts` — single exported function
`buildVisitIcs({ visits, protocolCodeById, calendarName })` →
`string`. Returns RFC 5545-compliant text/calendar payload.

- Each visit → one `VEVENT`.
- `UID = piqc-visit-<visit.id>@piqclinical.com` — stable so
  re-imports update existing events.
- `SUMMARY = "{visitName} · {participantCode}"`.
- All-day events when `time` is absent; `DTSTART;VALUE=DATE` only.
- Timed events: `DTSTART:<yyyymmddThhmmss>` with no TZID (treated
  as floating local time — matches what calendar apps do with
  PIQC's free-text time field).
- `DTEND = DTSTART + 1 hour` for timed events (typical visit
  block length); `DTEND;VALUE=DATE` of next day for all-day.
- `DESCRIPTION` includes protocol code + study day + procedures
  list + deviation reason / prior note if present.
- `STATUS = COMPLETED` when status is `completed`; `CANCELLED`
  when missed; otherwise omitted (calendar shows as confirmed
  tentative).

No external library — `.ics` is a simple line-oriented text format,
~80 LOC of escaping + CRLF folding.

### UI

Three callers, all wired identically:

- **TodayTab** — `Export calendar` button next to filters → exports
  the currently visible visits.
- **VisitsTab** — `Export calendar` button in the toolbar → exports
  the currently filtered visit list.
- **ReportsTab** — `Export calendar` button alongside the existing
  CSV / XLSX / PDF buttons → exports `scopedVisits`.

Each call site has the visits + protocolCodeById in scope already;
the new helper just wires `buildVisitIcs()` to a Blob download.

## Scope (files allowed)

### New

- `src/lib/site/calendarExport.ts`
- `src/lib/site/__tests__/calendarExport.test.ts`
- `plans/kiara/calendar-export.md` — this file.

### Modified

- `src/components/dashboard/site/TodayTab.tsx`
- `src/components/dashboard/site/VisitsTab.tsx`
- `src/components/dashboard/site/ReportsTab.tsx`

## Architecture layers touched

- [x] lib (pure builder)
- [x] component

## Mock data plan

None.

## Approved-by

Self.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Sibling tests pass — verify VEVENT shape, UID stability, all-day
  vs timed split, line folding.
- Manual:
  - TodayTab → Export calendar → download → import to Google
    Calendar → events land on the correct dates.
  - Re-import the same .ics → events update in place (UID match).
  - VisitsTab + ReportsTab → same.
