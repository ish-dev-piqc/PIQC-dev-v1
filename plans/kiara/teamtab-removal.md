---
owner: ki-dev-piqc
feature: teamtab-removal
status: active
started: 2026-06-01
target_pr:
---

# Cleanup: remove dead TeamTab.tsx; route TodayTab cert click to Org Team

## Context

After the unified Team tab PR, `TeamTab.tsx` (the standalone delegation log
component) is no longer rendered by the Organization page. Two stale uses
remain:

1. **Dashboard.tsx's defensive `case 'team'`** — still imports and renders
   TeamTab when the active dashboard tab is `'team'`. That tab isn't in the
   Site Mode tab list anymore, so it's only reachable via TodayTab's
   cert-expiry band navigation.
2. **TodayTab.tsx's cert-warning band** — `onNavigateToTeam` calls
   `onTabChange('team')`, which lands on the dead branch. The user clicks
   the band hoping to see expiring certs and lands on... the Team tab from
   before the unified redesign.

This PR re-routes the cert-warning click straight to the Organization page's
Team tab (where the unified list now shows the cert chips inline) and
deletes the now-orphan `TeamTab.tsx`.

## Design

### Deep-link to Organization → Team

A new App-level handler `handleNavigateToOrgTeam`:

- Saves the previous dashboard tab for the back-arrow path (same logic as
  `handleOpenOrganization`).
- Sets `organizationInitialTab = 'team'` so `OrganizationPage` starts on
  the Team sub-tab instead of the default Members.
- Sets `dashboardTab = 'organization'` and routes to the dashboard view.

`organizationInitialTab` is a new App state defaulting to `'members'`.
`handleOpenOrganization` resets it to `'members'` so the user-menu entry
point still lands on Members; `handleNavigateToOrgTeam` overrides to
`'team'` for the cert-click flow. Because `OrganizationPage` only mounts
when `resolvedActiveTab === 'organization'` (via Dashboard.tsx's
early-return branch), every entry into Organization is a fresh mount,
which means `useState(initialTab)` correctly picks up whichever value was
just set — no key prop or sync effect required.

### Dashboard.tsx plumbing

Two new props on `DashboardProps`:

- `onNavigateToOrgTeam?: () => void` — passed down to TodayTab's
  `onNavigateToTeam`.
- `organizationInitialTab?: OrgTab` — passed down to OrganizationPage.

The defunct `case 'team'` branch and the `TeamTab` import are removed.
`'team'` is removed from the `DashboardTab` union — nothing else still
references it after the TodayTab handler swap.

### OrganizationPage.tsx

Accepts a new `initialTab?: OrgTab` prop. `OrgTab` is exported from this
file so App.tsx can type its state. Internal `activeTab` `useState` uses
`initialTab ?? 'members'` as its initializer.

### Files deleted

- `src/components/dashboard/organization/team/TeamTab.tsx` — fully dead.

## Scope (files allowed)

### Modified

- `src/App.tsx` — adds `organizationInitialTab` state, `handleNavigateToOrgTeam` handler, passes both into `<Dashboard>`; `handleOpenOrganization` now also resets `organizationInitialTab` to `'members'`.
- `src/components/dashboard/Dashboard.tsx` — adds `onNavigateToOrgTeam` + `organizationInitialTab` to props; passes `initialTab` to `OrganizationPage`; wires TodayTab's `onNavigateToTeam` to `onNavigateToOrgTeam`; removes `'team'` from `DashboardTab` union; removes `case 'team'`; removes `import TeamTab`; exports `OrgTab` type forwarding from OrganizationPage.
- `src/components/dashboard/organization/OrganizationPage.tsx` — exports `OrgTab`; accepts `initialTab` prop; uses it in `useState` init.

### Deleted

- `src/components/dashboard/organization/team/TeamTab.tsx`

### Out of scope (forbidden)

- `src/components/dashboard/site/TodayTab.tsx` — keeps the existing
  `onNavigateToTeam?: () => void` prop signature. The prop name still
  reads naturally; Dashboard.tsx wires it to the new handler. No file
  touch required.
- `src/components/dashboard/organization/team/TeamFormDrawer.tsx` and
  `UnifiedTeamList.tsx` — unchanged in this PR.
- `src/lib/site/**` — `site_team_members` API and types stay where they
  are.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (Dashboard + App + OrganizationPage signature; TeamTab delete)
- [ ] test

## Mock data plan

None.

## Approved-by

- `@ish-dev-piqc` — `src/App.tsx` and `src/components/dashboard/Dashboard.tsx`
  are shared dashboard chrome (2-reviewer rule). Changes are additive
  (one new state + one new handler + two new props) plus a dead-branch
  removal. No behavior change for non-cert-click flows.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `grep -r "from.*TeamTab\b" src/` → no matches after delete
- Manual:
  - User menu → Organization → lands on Members tab (default behavior unchanged)
  - TodayTab cert-warning band click → Organization page opens on the
    Team tab; cert chips visible on rows in `UnifiedTeamList`
  - Back arrow from Org → returns to TodayTab (or whichever tab the user
    was on before)
  - Switching protocols in the in-page Team picker still works
