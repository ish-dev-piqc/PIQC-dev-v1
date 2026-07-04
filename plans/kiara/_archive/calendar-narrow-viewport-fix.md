---
owner: kiara
feature: calendar-narrow-viewport-fix
status: merged
merged: 2026-05-25
started: 2026-05-25
target_pr: #117
---

# Calendar week-view: hide redundant protocol chip in compact day columns

## Context

The week view of the Overview tab renders visit cards inside a 7-column day
grid (one column per weekday). Each visit card shows a status icon, time,
the protocol code chip (e.g. "BRIGHTEN-2"), the participant ID, and the
visit name — all squeezed into a column that's only ~100px wide on a
split-screen laptop. The chip's variable width is what pushes the
participant ID and visit name past the `truncate` cutoff, so users in
split-screen see chopped-off text.

The colored left-edge stripe on each card already identifies the protocol
visually. The text chip is redundant in this compact context and is the
single biggest contributor to crowding. The same `WeekVisitRow` component
is also used in the mobile vertical-stack view where rows are full-width
and the chip is fine — so we add a `compact` flag that the 7-column grid
sets and the mobile stack doesn't.

## Scope (files allowed)

- src/components/dashboard/site/TodayTab.tsx

## Out of scope (files forbidden)

- src/lib/site/protocolColors.ts (no palette change)
- src/components/dashboard/site/VisitsTab.tsx (separate surface, has its own layout)
- src/components/dashboard/site/VisitDetailDrawer.tsx (drawer has plenty of width)
- src/components/dashboard/site/* anything else
- supabase/** (frontend-only)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [x] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

Pure visual change inside an existing component. No new logic / hooks /
data flow. Manual verification at narrow + wide viewports.

## Mock data plan

None.

## Approved-by

`src/components/dashboard/site/` is Kiara's domain per `docs/CODEOWNERS.md`.
No second reviewer required, but flagging the PR with @ish-dev-piqc for
visibility since this touches the calendar UX surface they ship alongside.

## Verification

- [ ] On the deployed site signed in as a user with visits scheduled, resize the browser to half-screen (~720px wide). Open the Overview tab. Visit cards in the week view should no longer show the colored protocol code chip — participant ID and visit name should be fully visible (subject to existing `truncate` for very long names).
- [ ] At full-screen width (>1280px), the chip still shows as before.
- [ ] In the mobile vertical-stack view (resize browser narrower than `sm`, 640px), the chip is still visible inside each visit card because rows are full-width there.
- [ ] Day-detail drawer (click any day with visits) is unchanged.
- [ ] Month view is unchanged.
- [ ] `npm run build` passes (TS strict).
