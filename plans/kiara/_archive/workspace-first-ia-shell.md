---
owner: ki-dev-piqc
feature: workspace-first-ia-shell
status: merged
merged: 2026-06-12
started: 2026-06-04
target_pr: #317
---

# Workspace-first IA — shell (PR 1 of 6)

## Context

Positioning pivot: the app shifts from "Site Mode by default with an
implicit Audit Mode toggle" to "workspace-first with three peer
modes (Site, Audit, Sponsor coming-soon) plus a Chat overlay tool."
The collaborative surface — chat, decisions, documents, activity —
is the home; modes are tools you click into.

This PR ships only the **shell** so the new chrome is visible and
mode-switching routes through it. Each subsequent PR fills in
content:

1. **(this PR)** IA shell — LeftRail, dashboardTab routing for
   sponsor/workspace, remove Navbar mode toggle, last-mode resume.
2. Workspace hub v1 — `Today` (default) / Chat / Documents /
   Organization / Team / Manage / Draft activity tabs inside the
   hub. Migrate OrganizationPage tabs into the hub.
3. Sponsor coming-soon page (purple-themed) + notify-me capture.
4. Chat overlay (rail icon → slide-in panel; fold MentionsInbox into
   it; bell wiring).
5. Documents tab (new bucket, pinned board, source-unioned list).
6. Mobile polish (overlay = bottom sheet, rail collapse).
7. Confirm-leave guard — dirty-state registry + modal on mode
   switch. Lands as a follow-up to this PR.

## Design — this PR

### LeftRail

New persistent 56px rail mounted in `App.tsx` dashboard view (right
where the top Navbar currently sits — Navbar stays for user menu /
brand mark but loses its mode toggle).

Five icons + avatar:

- Workspace (purple, ti-layout-grid). Click → `setDashboardTab('organization')`.
- Divider.
- Site (blue, ti-clipboard-list). Click → `setMode('site')` + route to a sensible site tab.
- Audit (teal, ti-shield-check). Click → `setMode('audit')` + route to a sensible audit tab.
- Sponsor (purple, ti-building-skyscraper, 55% opacity, amber soon-dot). Click → `setDashboardTab('sponsor')`.
- Divider.
- Chat (coral, ti-message-circle). Stub — `console.log` only. Wired in PR 4.

Active icon highlights with a per-mode background tint (purple for
Workspace + Sponsor, blue for Site, teal for Audit, coral for Chat).
Hover shows a label tooltip to the right.

### Active-icon determination

Driven by current `dashboardTab` + `mode`:

- `dashboardTab === 'organization'` → Workspace.
- `dashboardTab === 'sponsor'` → Sponsor.
- Otherwise, `mode === 'site'` → Site; `mode === 'audit'` → Audit.

### Navbar slimming

Remove `renderModeSwitcher` + `renderModeDropdown` invocations from
`Navbar.tsx`. The rendering helpers stay but are unused — happy to
delete in a follow-up cleanup PR once the shell is verified in
prod. Keeping them around for the first PR so rollback is trivial
if the rail trips something.

### Routing additions

- New `DashboardTab` value: `'sponsor'`. App renders a tiny stub:
  `<div>Sponsor Mode page coming in PR 3 — placeholder.</div>`.
  The proper page lands in PR 3.

### Mode resume

`ModeContext` already persists `mode` to localStorage. App already
restores it on mount. No change here — the rail's Site/Audit icons
just toggle the existing state and re-renders pick it up.

For dashboardTab persistence, `App.tsx` already writes
`piq-dashboard-tab-v1`. Existing behavior.

## Scope (files allowed)

### New

- `src/components/dashboard/LeftRail.tsx`
- `plans/kiara/workspace-first-ia-shell.md` — this file.

### Modified

- `src/App.tsx` — mount `<LeftRail>`; add `'sponsor'` to the
  `VALID_DASHBOARD_TABS` set; render the sponsor placeholder when
  active.
- `src/components/Navbar.tsx` — remove the mode-switcher render
  calls (mobile + desktop).
- `src/components/dashboard/Dashboard.tsx` — add `'sponsor'` to
  the `DashboardTab` union, route it to the placeholder.

## Out of scope

- Workspace hub content (PR 2).
- Sponsor page content (PR 3).
- Chat overlay (PR 4).
- Documents tab (PR 5).
- Mobile polish (PR 6).
- Confirm-leave guard (PR 1b).

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self — all Site-Mode-adjacent shared chrome changes are within
Kiara's domain. No audit / sotr file edits.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Dashboard loads with the rail visible at left.
  - Clicking Site / Audit toggles `mode` and the active rail icon.
  - Clicking Workspace lands on the existing OrganizationPage; the
    workspace icon glows.
  - Clicking Sponsor shows the placeholder text.
  - Returning users land in their last mode (existing
    `piq-mode-v1` localStorage behavior).
  - Old Navbar mode toggle is gone; user menu + protocol picker
    still work.
