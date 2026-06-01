---
owner: ki-dev-piqc
feature: organization-page-polish
status: active
started: 2026-06-01
target_pr:
---

# Organization page polish — full-screen destination + scope clarity

## Context

PR 1 (#204) stood up the Organization page as a regular dashboard tab. Live testing surfaced UX gaps:

1. The page sits alongside Today / Visits / Reports in the dashboard tab strip. It doesn't feel like its own destination — it feels like another tab.
2. There's no "Organization" page title. The org name shows but the framing is weak.
3. **Organization-level vs protocol-level scope is invisible.** The "Members" tab manages org-wide membership. The "Team" tab manages a specific protocol's team. Both look the same. Users don't know whether the action they're about to take affects the whole org or just one protocol.
4. Content gets cut off — the dashboard's bordered panel uses `overflow-hidden`, so MembersTab's pending-invites section runs off-screen with no scroll.

## Design

### Hide the dashboard tab strip; let Organization own the chrome

When `dashboardTab === 'organization'`, Dashboard.tsx renders a different layout: no Site-Mode tab strip (Today / Visits / Reports etc.), no bordered content panel. OrganizationPage takes the full content area and renders its own tab strip in that same spot. The strip shows a "← Dashboard" back button on the left and the org tabs (Members, Team, future Chat/Activity) inline.

Clicking the back arrow restores the dashboard tab the user was on before opening Organization. App.tsx tracks the previous tab and passes a `handleExitOrganization` callback down through Dashboard to OrganizationPage.

### Page header — "Organization" + org name + role

Below the tab strip, OrganizationPage renders a substantial header:

- Eyebrow: "Organization"
- Title: `{activeOrg.name}` (large)
- Role badge: "Site administrator" (with crown icon) or "Site member"

This is the page title the user said was missing. It's clearly an Organization context — distinct from anything in Site Mode.

### Scope-clear labeling on both tabs

**Members tab** — reframed as "Organization members":
- Section heading: "Organization members (N)" (was "Members")
- Invite section heading: "Invite to organization" with a one-line subhead: "These users get access to the whole org. To control who can see a specific protocol, use the Team tab."
- Sticky CTA at top-right of the tab: "Invite to organization" button (admin-only) that scrolls to or focuses the invite form. Makes the org-level action obvious at a glance.

**Team tab** — reframed as "Protocol team":
- Eyebrow above the existing TeamTab content: "Protocol team — {activeProtocol.code}". Subhead: "These users are assigned to this specific protocol. To add a brand-new person to the org, use the Members tab."
- The protocol picker stays where it is (still consuming the navbar's active protocol via `useProtocol()` per the PR 1 deferral). When no protocol is picked: explicit empty state explaining that and pointing at the protocol picker.

Together the two framings answer "what does the button I'm about to click do?" before the click happens.

### Scroll fix

OrganizationPage's outer wrapper gets `overflow-y-auto` and a real height (`flex-1 min-h-0`). Content below the tab strip is scrollable inside the page; the dashboard chrome (navbar at top) stays fixed.

## Scope (files allowed)

### Modified

- `src/App.tsx` — add `previousDashboardTab` state, save-and-switch in `handleOpenOrganization`, new `handleExitOrganization`, pass through to `<Dashboard>`.
- `src/components/dashboard/Dashboard.tsx` — accept `onExitOrganization` prop; early-return a full-screen Organization layout when `resolvedActiveTab === 'organization'` (no standard tab strip, no bordered panel, scrollable content).
- `src/components/dashboard/organization/OrganizationPage.tsx` — rewritten layout: back-button + tab strip in the chrome row, big page header below ("Organization" + org name + role badge), scrollable content below.
- `src/components/dashboard/organization/MembersTab.tsx` — reframe headings ("Organization members", "Invite to organization"), add scope-helper subhead, add sticky "Invite to organization" CTA in admin view.
- `plans/kiara/organization-page-polish.md` — this file.

### Out of scope (forbidden)

- Moving `TeamTab.tsx` out of `src/components/dashboard/site/` — same deferral as PR 1. The framing wrapper goes around it inside OrganizationPage; the file stays put.
- Per-protocol channels, chat, activity log — still PR 2/3+.
- `src/lib/orgs/**` — no API change.
- `supabase/migrations/**` — no DB change.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component
- [ ] test (purely UI polish; existing tests still cover data flows)

## Mock data plan

None.

## Approved-by

- `@ish-dev-piqc` — `src/components/dashboard/Dashboard.tsx` is shared dashboard chrome (2-reviewer rule). Change is additive — new early-return branch for `'organization'` tab; existing site/audit tab rendering is untouched. App.tsx changes are scoped to navigation state for the new exit flow.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `npx vitest run` → existing tests pass
- Manual:
  - User menu → Organization → full-screen Organization view; no Today/Visits/Reports tab strip; "← Dashboard" back button visible
  - Click "← Dashboard" → returns to the tab that was active before opening Organization
  - Members tab heading clearly says "Organization members"; invite section clearly says "Invite to organization"; helper subhead explains the difference from the Team tab
  - Team tab eyebrow reads "Protocol team — {protocol code}"; helper subhead explains the difference from the Members tab
  - With no protocol active, Team tab shows an explicit empty state pointing at the protocol picker
  - Content scrolls; pending invites list no longer cut off
