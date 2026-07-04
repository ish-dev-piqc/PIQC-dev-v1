---
owner: ki-dev-piqc
feature: workspace-back-and-calendar
status: merged
merged: 2026-06-29
started: 2026-06-13
target_pr: #385
---

# Workspace polish — fix back label + clickable calendar days

## Context

Two reports from usage:

1. The Organization back button kept reading "Back to Dashboard" even
   after the contextual-label PR shipped. Root cause: `Dashboard.tsx`
   renders `OrganizationPage` in two places (a defensive switch-case
   fallback and the actual early-return). Only the fallback passed
   `exitLabel`; the early-return — which is the path that always
   runs — didn't. So the prop never reached the page.
2. Even with the prop wired, `previousDashboardTab` defaulted to
   `'today'`, making the label read "Back to Today" when the user had
   never actually been on Today (e.g., direct workspace deep-link or
   first paint).
3. The mini calendar on the workspace hub was a read-only visual —
   clicking days did nothing. User wanted the same behavior as Site
   Mode's calendar (click a day, see that day's visits).

## Design

### Back label

- Pass `exitLabel` in the Dashboard early-return render.
- `previousDashboardTab` becomes `DashboardTab | null`. `null` =
  "no prior tab", in which case the back button reads just `"Back"`
  (not "Back to Dashboard"). Once any guarded nav saves a prior tab,
  the label becomes `"Back to {tab}"`.
- `handleExitOrganization` falls back to `'today'` when prev is
  `null` so the back action still goes somewhere sensible.

### Calendar click

Mirror the Site Mode Today tab pattern at a lighter scale (no
separate drawer — the hub calendar sits next to a list section
already; selecting a day repoints the list):

- New `selectedDay` state (ymd string), defaults to `today`.
- Each calendar day becomes a `<button>`. Click → `setSelectedDay`.
- The "Today's visits" section below the calendar becomes
  "{Weekday, Mon DD} visits" when a non-today day is selected.
- Selected day shows a ring outline; today still gets the filled
  blue background.
- A "Back to today" link appears in the section header when off-day,
  so the user can jump back without hunting for today on the
  calendar.
- "Happening now" calculation stays anchored to today (separate
  memo) so it doesn't bleed into the user's day-browsing.

## Scope (files allowed)

### New

- `plans/kiara/workspace-back-and-calendar.md` — this file.

### Modified

- `src/App.tsx` — `previousDashboardTab` becomes nullable;
  `backLabel` becomes `string | undefined`.
- `src/components/dashboard/Dashboard.tsx` — pass `exitLabel` to
  the early-return `OrganizationPage` render.
- `src/components/dashboard/organization/OrganizationPage.tsx` —
  render just `"Back"` when `exitLabel` is undefined.
- `src/components/dashboard/organization/HubTodayTab.tsx` —
  `selectedDay` state, clickable day buttons, dynamic section
  header, "Back to today" link, separate `todaysVisits` for the
  Happening-now calc.

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self (Site Mode / workspace surface).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Direct deep-link to workspace → back button reads just "Back".
  - From Visits → click Workspace → "Back to Visits".
  - Mini calendar: click any day with visits → list below repoints
    to that day's visits, "Back to today" appears.
  - Click "Back to today" → list returns to today.
  - Today still highlighted blue; selected non-today day gets a ring.
  - "Happening now" remains anchored on today regardless of selection.

## Mechanical checks

- No new color classes.
- No `: any` in `src/lib/**`.
- Plan MD referenced above.
