---
owner: ki-dev-piqc
feature: workspace-hub-v1
status: merged
merged: 2026-06-12
started: 2026-06-04
target_pr: #319
---

# Workspace hub v1 — Today default + Documents stub (PR 2 of 6)

## Context

PR 1 dropped the LeftRail with a Workspace icon that routes to
`dashboardTab='organization'` — the existing OrganizationPage.
This PR rebuilds that page into the **workspace hub** the
brainstorm spec'd: Today as the default tab, plus a Documents
stub, alongside the existing Organization / Team / Chat / Manage
/ Draft activity tabs.

The other PRs in the workspace-first sequence (Sponsor page,
chat overlay, Documents real content, mobile polish) ship after
this.

## Design

### Tab structure

`OrgTab` union extended with `'today'` and `'documents'`. Final
tab order on the hub:

1. **Today** (default for new users; everyone — replaces the
   old "Organization" default)
2. **Chat** (unread pill in tab row)
3. **Documents** (stub — full content lands in PR 5)
4. **Organization** (the roster — current MembersTab)
5. **Team** (per-protocol team)
6. **Manage** (admin-only)
7. **Draft activity** (admin-only)

Default flipped from `'organization'` → `'today'`. Legacy
localStorage migration:

- `'members'` → `'organization'` (already in place)
- otherwise valid `OrgTab` values pass through
- everything else → fallback to `'today'`

### Page header

Subtitle was "Organization · {orgName} · {role}". New copy:
"Workspace · {orgName} · {role}" so the workspace-first framing
reads in the chrome too.

### Today tab content

In rough vertical order:

1. **Greeting** — "Welcome back, {firstName}".
2. **Sub-line** — "{N} protocols · {M} members".
3. **Stats row** — three colored cards (Site-blue, mentions-amber,
   Audit-teal):
   - Visits this week
   - Mentions waiting (unread @-mentions count)
   - Decisions need your ack
4. **Mode tiles** — three colored tiles (Site / Audit / Sponsor
   coming-soon). Clicking enters the mode (Site → Today,
   Audit → audit-overview, Sponsor → sponsor placeholder).
5. **Today's visits** — list of today's visits across all the
   user's protocols, sorted by time. Each row: time · visit
   name · participant · protocol pill · "Open" button (routes
   into Site Mode + opens the visit drawer via existing
   localStorage pending-visit pattern).
6. **Decisions awaiting your ack** — list of decisions where
   the caller is in `chat_decision_acks.required_user_id` with
   `acknowledged_at IS NULL`. Each row: title · channel ·
   "Acknowledge" button (routes to the Chat tab with the
   decision pre-focused).

Out of scope for this PR:

- Mini week calendar (polish follow-up).
- "Happening now" hot-row with live-time tracker (polish).
- Overdue deviation sign-offs (needs a new query helper).
- Pending access-request roll-up (deferred — small, can land
  with the calendar polish).

### Documents tab stub

Single centered card matching the Sponsor placeholder shape:
"Documents · Coming soon — full content lands in PR 5." Just so
the tab is clickable and route-stable.

## Scope (files allowed)

### New

- `src/components/dashboard/organization/HubTodayTab.tsx`
- `src/components/dashboard/organization/HubDocumentsTab.tsx`
- `plans/kiara/workspace-hub-v1.md` — this file.

### Modified

- `src/components/dashboard/organization/OrganizationPage.tsx` —
  extend `OrgTab`, add Today + Documents to the tabs list,
  default to Today, relabel the page header, route the new tabs.

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self.

## Out of scope (later PRs)

- Sponsor coming-soon page content (PR 3).
- Chat overlay + mentions fold-in (PR 4).
- Documents tab real content (PR 5).
- Mobile polish (PR 6).
- Confirm-leave guard (PR 1b).
- Mini calendar / happening-now live row / overdue deviations.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Click Workspace in the rail → land on Today tab (not
    Organization).
  - Stats row shows actual counts pulled from live data.
  - Mode tiles route correctly (Sponsor → coming-soon stub).
  - Today's visits list shows the right rows for "today" across
    all the user's protocols.
  - Decision-ack list shows decisions the current user is
    required to ack.
  - Documents tab shows the stub.
  - Existing Organization / Team / Chat / Manage / Draft
    activity tabs render unchanged.
  - Hard refresh → returns to the last tab (existing
    `piq-org-tab-v1` persistence).
