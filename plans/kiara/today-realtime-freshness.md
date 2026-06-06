---
owner: ki-dev-piqc
feature: today-realtime-freshness
status: active
started: 2026-06-04
target_pr:
---

# Today tab — realtime freshness banner

## Context

SiteDataContext already realtime-subs on `site_visits` and
`site_participants` and calls `refresh()` on any change. The data
arrives in TodayTab automatically — but the UI never tells the user
*"something new just happened."* Coordinators often leave the tab
open in the background; a passively-updated visit count is easy to
miss.

This PR adds a small banner above the Today view counting visits +
participants that arrived since the tab mounted. Click to refresh
(no-op since data is already there) and dismiss; dismiss
re-snapshots so subsequent arrivals trigger again.

## Design

In-session only. No localStorage persistence — if you reload the
tab, the snapshot resets. That avoids "37 new items in the last
week" pile-ups on re-visit.

### State (local to TodayTab)

- `baselineVisitIds: Set<string>` — captured on first non-empty
  visits load.
- `baselineParticipantIds: Set<string>` — same.
- Both initialized to `null` until the first non-empty render so
  page-1-load doesn't count as "new."

On every `useSiteData` change (which already covers realtime), we
diff the current id sets against baselines.

### Banner — `TodayFreshnessBanner.tsx`

Renders only when delta count > 0. One line:

> 🔔 **3 new visits and 1 new participant** since you opened this
> tab. _[Dismiss]_

Slate color, single dismiss link. No "Jump to" button in v1 — new
items already appear in the list; the banner is just an FYI.

## Scope (files allowed)

### New

- `src/components/dashboard/site/TodayFreshnessBanner.tsx`
- `plans/kiara/today-realtime-freshness.md` — this file.

### Modified

- `src/components/dashboard/site/TodayTab.tsx` — wire the banner.

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self-only — pure component change, no schema / API / RLS impact.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Open Today tab as user A. As user B in another browser,
    schedule a visit on protocol A is also viewing. Within ~1s,
    A's Today tab shows "1 new visit since you opened this tab."
  - Dismiss → banner clears. Add another visit → banner reappears
    with count 1.
  - Hard refresh the page → banner gone (snapshot reset).
