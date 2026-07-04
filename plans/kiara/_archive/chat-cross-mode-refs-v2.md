---
owner: ki-dev-piqc
feature: chat-cross-mode-refs-v2
status: merged
merged: 2026-06-04
started: 2026-06-04
target_pr: #285
---

# Chat: cross-mode references v2 — wire "Go to" navigation

## Context

`chat-cross-mode-refs.md` (v1) shipped `[protocol:CODE]`,
`[visit:UUID]`, `[participant:CODE]` references with chip rendering
and a "Go to" button on the popover that was deliberately greyed out
("coming soon" in v2). This PR wires those buttons.

Click `Go to visit` → switches to Site Mode's Visits tab and opens
the visit detail drawer for that visit.
Click `Go to participant` → switches to Site Mode's Participants tab
and opens the participant profile drawer for that participant.

## Design

### App-level navigation handlers

Two new handlers in `App.tsx`:

- `handleNavigateToVisit(visitId)` — writes `piq-pending-visit-v1` to
  localStorage, sets `dashboardTab` to `'visits'`, and routes to the
  dashboard view.
- `handleNavigateToParticipant(participantCode)` — writes
  `piq-pending-participant-v1` to localStorage, sets `dashboardTab`
  to `'participants'`, routes to dashboard view.

These mirror the existing `handleNavigateToOrgChat` pattern from the
mentions inbox — localStorage acts as the "open this on next mount"
breadcrumb, sidestepping prop drilling through Dashboard.

### Plumbing — context

The chat surface needs a way to call these handlers without ChatTab
knowing about App-level routing. New `ChatNavigationContext`
(mounted in the App tree alongside `UnreadMentionsProvider`) exposes:

```ts
interface ChatNavigationContextValue {
  navigateToVisit: (visitId: string) => void;
  navigateToParticipant: (participantCode: string) => void;
}
```

`ReferencePopover` consumes this context and wires the buttons.
ChatTab doesn't need any changes.

### Destination tabs — VisitsTab + ParticipantsTab

Each destination tab reads its corresponding localStorage key on
mount. If present, the tab opens the relevant drawer for that
visit/participant and clears the key so a refresh doesn't keep
re-opening.

VisitsTab already has `openVisit` state for the drawer; it just
needs the read-pending effect. ParticipantsTab already has a
`ParticipantProfileDrawer` mount with `selected` state; same
addition.

## Scope (files allowed)

### New

- `src/context/ChatNavigationContext.tsx` — context + provider + hook.
- `plans/kiara/chat-cross-mode-refs-v2.md` — this file.

### Modified

- `src/App.tsx` — adds the two handlers, mounts the provider with
  them as the value.
- `src/components/dashboard/organization/chat/ReferencePopover.tsx`
  — `Go to` button now wired, no longer disabled.
- `src/components/dashboard/site/VisitsTab.tsx` — reads
  `piq-pending-visit-v1` on mount; opens its detail drawer.
- `src/components/dashboard/site/ParticipantsTab.tsx` — same pattern
  with `piq-pending-participant-v1`.

## Architecture layers touched

- [ ] migration / RPC / adapter / test
- [x] context (new ChatNavigationContext)
- [x] component (Popover + two Site Mode tabs)

## Mock data plan

None.

## Approved-by

Self-only — Site Mode tab edits are mechanically-trivial
auto-open-on-mount hooks; the App.tsx delta is two more navigation
handlers in the existing pattern.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - In chat, click a `[visit:UUID]` chip → popover opens → click
    `Go to visit` → switches to Visits tab; the matching visit's
    detail drawer auto-opens.
  - Same with `[participant:P-0023]` → Participants tab + profile
    drawer opens.
  - `[protocol:CODE]` click still does the v1 behavior (switches
    active protocol; no nav).
  - Refresh on Visits tab after a deep-link → drawer doesn't re-open
    (key cleared).
