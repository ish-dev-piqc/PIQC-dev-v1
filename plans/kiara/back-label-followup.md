---
owner: ki-dev-piqc
feature: back-label-followup
status: active
started: 2026-06-13
target_pr:
---

# Back-label follow-up — LeftRail nav must save previousDashboardTab

## Context

PR #361 added a contextual `backLabel` to the OrganizationPage back
button, derived from `previousDashboardTab`. Bug: the LeftRail
Workspace icon and the Navbar mobile workspace nav both routed to
'organization' by calling `setDashboardTab('organization')` directly
**without** first saving the prior tab into `previousDashboardTab`.

Only the user-menu's `handleOpenOrganization` did the save. Result:
clicking Workspace from anywhere → back button always reads "Back to
Today" (the default initial value) instead of where you came from.

## Design

New helper in App.tsx:

```ts
const navigateToTab = (tab: DashboardTab) => {
  if (
    (tab === 'organization' || tab === 'settings') &&
    dashboardTab !== 'organization' &&
    dashboardTab !== 'settings'
  ) {
    setPreviousDashboardTab(dashboardTab);
  }
  setDashboardTab(tab);
};
```

Use this helper from any nav path that targets the cross-mode
destinations (organization / settings) — which both have a back
button. In-mode tab switches keep using `setDashboardTab` directly
since they don't need the memory.

Call sites updated:
- LeftRail `onDashboardTabChange` callback
- Navbar mobile workspace nav, case 'workspace'

The existing single-purpose handlers (`handleOpenOrganization`,
`handleNavigateToOrgTeam`, `handleNavigateToOrgChat`) already save
the previous tab — those are unchanged.

## Scope (files allowed)

### New

- `plans/kiara/back-label-followup.md` — this file.

### Modified

- `src/App.tsx` — add `navigateToTab` helper; use it from LeftRail's
  `onDashboardTabChange` and Navbar's mobile workspace nav.

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - From Visits tab → click Workspace icon → back button says
    "Back to Visits".
  - From Today tab → click Workspace icon → "Back to Today".
  - From Participants tab → mobile hamburger → Workspace home →
    back button says "Back to Participants".
  - From Sponsor → click Workspace → "Back to Sponsor mode".

## Mechanical checks

- No new color classes.
- No `: any` in `src/lib/**`.
- Plan MD referenced above.
