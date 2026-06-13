---
owner: ki-dev-piqc
feature: protocol-detail-drawer
status: active
started: 2026-06-13
target_pr:
---

# Protocol detail drawer (Site Mode)

## Context

Site coordinators work inside one of four tabs (Today, Visits,
Participants, Reports) and constantly need to cross-reference "what
protocol is this?" — basic stats, audit signals, recent visits,
pinned documents. Right now they have to switch tabs or open
multiple drawers to get that picture.

This PR adds a single read-only drawer that surfaces the per-
protocol info in one slide-in pane, triggered from a small Info
icon button in each tab's header.

## Design

### What the drawer shows (top to bottom)

1. **Header** — protocol code + title + study sponsor (free-text
   `sponsor` column from `protocols` table).
2. **Audit signals** — reuse `AuditSignalsBanner`.
3. **Visit activity (last 30 days)** — five stat cards (scheduled,
   completed, missed, deviation, overdue) computed client-side from
   `useSiteData()` so no new RPC is needed.
4. **Enrollment** — stacked horizontal bar + legend for participant
   statuses (same shape as Sponsor v2 drawer).
5. **Recent visits** — last 5 visits across all participants on
   this protocol, sorted by date desc, status pill + participant
   code + visit name.
6. **Pinned documents** — pinned chat attachments for this
   protocol's channel, max 5, with a "See all in Documents tab"
   link.

### Data path

100% client-side aggregation from `useSiteData()` (visits + participants
already loaded) and `listChannelAttachments('protocol', id)` for the
pinned docs. No new RPC, no migration.

### Triggers

Small `Info` icon button next to the protocol code in each tab's
header:

- TodayTab — adjacent to the existing `· Viewing {activeProtocol.code}`
  inline label
- VisitsTab — next to the `{activeProtocol.code}` heading
- ParticipantsTab — same
- ReportsTab — same (only when an active protocol is selected)

Click → opens the drawer; close on Esc / backdrop / X.

## Scope (files allowed)

### New

- `plans/kiara/protocol-detail-drawer.md` — this file.
- `src/components/dashboard/site/ProtocolDetailDrawer.tsx` — drawer.

### Modified

- `src/components/dashboard/site/TodayTab.tsx` — trigger button.
- `src/components/dashboard/site/VisitsTab.tsx` — trigger button.
- `src/components/dashboard/site/ParticipantsTab.tsx` — trigger
  button.
- `src/components/dashboard/site/ReportsTab.tsx` — trigger button.

## Architecture layers touched

- [x] component

No migration. No RPC. No adapter. No API layer. All aggregation is
client-side over the existing `useSiteData` cache and the existing
`listChannelAttachments` helper.

## Mock data plan

None.

## Approved-by

Self (Site Mode).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - With an active protocol → Info icon visible next to protocol
    code in all four tabs. Click → drawer slides in with the six
    sections.
  - Counts match: scheduled+completed+deviation+missed+overdue ==
    total visits in last 30 days for this protocol.
  - Enrollment counts match Participants tab filtered to this
    protocol.
  - "See all in Documents tab" link navigates to the hub Documents
    tab and pre-scopes to this protocol.
  - Esc / backdrop / X close the drawer.

## Mechanical checks

- Mode isolation: site only (imports from `crossMode/auditSignals`
  for the signal counts via the existing banner; imports
  `listChannelAttachments` from `lib/orgs/` which isn't a mode).
- No `.channel(` outside `src/context/`.
- No `@supabase/supabase-js` imports in components.
- No `: any` in `src/lib/**` — no lib edits.
- Plan MD referenced above.
- No new `*Api.ts` / `*Adapter.ts` — no sibling tests required.
