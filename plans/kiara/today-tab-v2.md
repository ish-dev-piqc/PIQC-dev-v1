---
owner: ki-dev-piqc
feature: today-tab-v2
status: active
started: 2026-06-04
target_pr:
---

# Today tab v2 — calendar + happening-now + needs-your-attention

## Context

Today tab v1 (PR 2) shipped a flat list of today's visits + a
decisions-need-ack section. Brainstorm called out four more
elements that got deferred:

- Week mini calendar with event-density dots
- "Happening now" hot row for visits within ±60 minutes
- Overdue deviation sign-offs section
- Pending access requests section

This PR ships all four.

## Design

### Layout

Hub Today tab becomes a 2-column layout below the stats + mode
tiles (which stay full-width above):

- Left column (~220px, hidden below `lg`): week mini calendar.
- Right column (flex): vertically stacked sections —
  - Happening now (only when ≥1 visit matches)
  - Today's visits (existing)
  - Decisions awaiting your ack (existing)
  - Overdue deviation sign-offs (new)
  - Pending access requests (new)

Below `lg` (1024px), the layout stacks: calendar above the list
sections.

### Mini calendar

Week view (Sun–Sat) with a header showing the month. Today is
visually distinguished (filled blue). Each day with at least one
visit shows up to three small dots beneath the date — blue for
visits, amber for any deviation, teal for completed.

Read-only — clicking dates lands in a polish follow-up. Legend at
the bottom matches the three dot colors.

### Happening now

A visit is "happening now" if `visit.date === today` AND its
`time` (parsed) falls within `now - 60min ≤ start ≤ now + 60min`.
Coral background, sub-timestamp ("started 12m ago" or "starts in
35m"), `Open visit` button.

### Overdue deviation sign-offs

Visits with `status === 'deviation'` AND `deviationReason` is null
(meaning the deviation was logged but never explained) — across all
the user's protocols, last 30 days. Surfaced because regulators
care about deviation timeliness.

### Pending access requests

`listProtocolAccessRequests` for every protocol the user has access
to, filtered to `status === 'pending'`. Each row shows the
requester + protocol + when requested + an `Approve / deny`
indicator button (or, if the user can't act on it, a passive label).
Clicking routes to the Manage tab where the actual approve/deny
controls live.

## Scope (files allowed)

### New

- `plans/kiara/today-tab-v2.md` — this file.

### Modified

- `src/components/dashboard/organization/HubTodayTab.tsx` — full
  expansion.

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Today tab shows mini calendar on the left at desktop
    widths; below `lg`, calendar stacks above the list.
  - Days with visits show density dots.
  - Visit scheduled for the current hour (or within 60 min)
    shows in "Happening now" with coral row + relative-time
    sub-text.
  - Visit with `status = 'deviation'` but no reason → appears in
    overdue section. Click row → opens the visit drawer via
    existing `navigateToVisit` pattern so the user can fill in
    the deviation reason.
  - Open access requests on your protocols show in the section
    with requester + protocol code + "Review in Manage" link.
  - Mobile (<lg): everything stacks vertically.
