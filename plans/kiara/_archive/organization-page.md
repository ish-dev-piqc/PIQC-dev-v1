---
owner: ki-dev-piqc
feature: organization-page
status: merged
merged: 2026-06-01
started: 2026-05-30
target_pr: #206
---

# Organization page (PR 1 of N): scaffold + Members + Team + drawer removal

## Context

Org management is sprawling out of the side-panel drawer. The roster + invite form + pending invites already fill it, and we want to add team management, chat, and activity log. A side-panel doesn't have room. Drawer also makes substantive workflows hard to find — "open the user menu, click Organization" produces a popup, not a destination.

Simultaneously, Site Mode's "Team" tab (`site_team_members`: protocol team roles, certifications, delegated tasks) is conceptually team-management, not patient-coordination. It belongs alongside the rest of org/team workflows, not next to Today / Visits / Participants.

This PR does both:
1. Stand up a new top-level dashboard tab "Organization" with its own tabbed page.
2. Lift the existing drawer content into a Members tab. Delete the drawer.
3. Move Site Mode's Team tab into the Organization page. Drop it from Site Mode's nav.

### PR sequence (this is PR 1)

| PR | What |
|---|---|
| **This one** | New Organization page; Members tab (from drawer); Team tab (from Site Mode); drawer removed; user-menu "Organization" item navigates directly. |
| PR 2 | Org chat: general channel (everyone in the org). Establishes messages table + realtime + composer + list primitives. |
| PR 3 | Per-protocol channels auto-synced to `protocol_members WHERE role IN ('coordinator', 'member')` via trigger. Viewers + guests excluded from chat — they're consumers, not collaborators. |
| PR 4+ | Trial-specific features ported from `plans/kiara/protocol-collaboration.md` (decision capture, cross-mode refs, read confirmation, auto-import events, file uploads with contamination defenses). One PR each. |

Once this sequence lands, `plans/kiara/protocol-collaboration.md` gets restatused to `superseded` — its scope is absorbed into channels-in-the-Organization-page.

## Design

### Drawer fully removed

The existing `OrgSettingsDrawer` is deleted. The user-menu "Organization" item in the Navbar now sets the dashboard tab to `'organization'` directly. No popup, no quick-add. If you want to invite someone, you go to the Organization page — that's the destination.

### Page structure (v1)

```
Dashboard tab: "Organization"

OrganizationPage.tsx
  ├─ Header (org name + role badge, e.g. "PIQC · Site administrator")
  └─ Tab strip
       ├─ Members         (THIS PR) — org-wide roster, invite form, pending invites, cancel-invite
       ├─ Team            (THIS PR) — protocol-scoped team, with its OWN protocol picker inside the tab
       ├─ Chat            (PR 2)
       └─ Activity log    (future)
```

The Team tab has its own **in-page protocol picker** — independent of the Navbar's active protocol. The Organization page is its own surface; what's selected there doesn't have to match what Site Mode is currently on. Picker defaults to the Navbar's active protocol on first load (sensible starting point), then drifts independently as the user clicks around in-page. State stored locally to the tab; no global effect.

Empty state when no protocol is picked (or the user belongs to zero protocols): "Pick a protocol above to view its team."

### Site Mode tab shrink

Site Mode loses the Team tab. The remaining Site Mode tabs (Today, Visits, Participants, Reports, Ask) stay where they are. Site Mode is now focused on patient-facing workflows; team-management moves to its conceptual home.

### File relocation

Team-related files move from `src/components/dashboard/site/` to `src/components/dashboard/organization/team/`. This is a pure move + import-path update — no behavior change. The `site_team_members` table, `SiteTeamMember` type, `siteApi.fetchTeamMembers()`, etc., all stay where they are (still owned by Site Mode lib for now; a deeper refactor can move them later if desired).

Files to move:
- `src/components/dashboard/site/TeamTab.tsx` → `src/components/dashboard/organization/team/TeamTab.tsx`
- `src/components/dashboard/site/TeamFormDrawer.tsx` → `src/components/dashboard/organization/team/TeamFormDrawer.tsx`

Anything else in Site Mode that imports these — update the imports.

## Scope (files allowed)

### New files

- `src/components/dashboard/organization/OrganizationPage.tsx` (NEW) — page shell with tab strip; conditionally renders MembersTab / TeamTab. Tab order: Members → Team → Chat → Activity (last two placeholder/hidden in PR 1).
- `src/components/dashboard/organization/MembersTab.tsx` (NEW) — org roster + invite form + pending invites + cancel-invite. Content lifted verbatim from the deleted drawer.
- `src/components/dashboard/organization/team/TeamProtocolPicker.tsx` (NEW) — small in-page protocol-picker chip; defaults to Navbar's active protocol on first mount, then drifts independently via local state.

### Moved files (file deletion + recreation; same git history if `git mv`)

- `src/components/dashboard/site/TeamTab.tsx` → `src/components/dashboard/organization/team/TeamTab.tsx`
- `src/components/dashboard/site/TeamFormDrawer.tsx` → `src/components/dashboard/organization/team/TeamFormDrawer.tsx`

`TeamTab.tsx`'s prop shape gets a small adjustment: instead of consuming the Navbar's active protocol from `useProtocol()`, it accepts a `protocolId: string | null` prop passed in from `OrganizationPage`. The page owns the in-page picker state and passes the selection down. Empty state when null.

### Deleted

- `src/components/dashboard/orgs/OrgSettingsDrawer.tsx` — fully removed. Page replaces it.

### Modified

- `src/components/dashboard/Dashboard.tsx` — add `'organization'` to `DashboardTab` union; render `<OrganizationPage />`; drop `'team'` from the Site Mode tab list; update tab-config rendering accordingly.
- `src/components/Navbar.tsx` — user-menu "Organization" item now sets dashboard tab instead of opening the drawer. Drop `orgDrawerOpen` state and `<OrgSettingsDrawer />` mount. Remove the import.
- Any Site Mode file that imports `./TeamTab` or `./TeamFormDrawer` — update import paths to the new `organization/team/` location.
- `plans/kiara/organization-page.md` — this file.

## Out of scope (files forbidden)

- Chat surface, channels, messages tables, realtime — PR 2.
- Per-protocol channel auto-sync (`protocol_members` trigger) — PR 3.
- Activity log, Settings tab inside the Organization page — future.
- Anything in `src/lib/orgs/` — no API changes needed; same `listOrgMembersWithProfile` / `createOrgInvite` / etc. powers the lifted MembersTab.
- Anything in `src/lib/site/` (team API, types) — keeping the data layer where it is for now. A deeper refactor can move `siteApi.fetchTeamMembers` / `SiteTeamMember` later if we want full domain alignment.
- `supabase/migrations/**` — no DB change for PR 1.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (new OrganizationPage + MembersTab; moved Team files; deleted drawer; Navbar + Dashboard tab registration)
- [ ] test (lifted content is already exercised by existing tests; no new tests needed)

## Mock data plan

None.

## Approved-by

- `@ish-dev-piqc` — for `src/components/dashboard/Dashboard.tsx` and `src/components/Navbar.tsx` (shared dashboard chrome; 2-reviewer rule). Changes are: add a tab, remove a tab, remove a drawer integration. No existing tab's behavior changes (apart from `team` being relocated, which still works the same in its new home).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `npx vitest run` → existing tests pass; no new tests required for PR 1
- Manual:
  - Click user menu → "Organization" → navigates to the Organization page (no popup drawer)
  - Organization page → Members tab: roster + invite form + pending invites + cancel-invite all work (parity with the drawer that existed before)
  - Organization page → Team tab: an in-page protocol picker appears; default selection matches the Navbar's active protocol; team list + add/edit/remove works the same as Site Mode's Team tab did before
  - Change selection in the in-page picker → team view updates; Navbar's active protocol stays unchanged (independent state)
  - With no protocol picked (or no protocols owned by the org), Team tab shows the "Pick a protocol above to view its team" empty state
  - Site Mode's tab nav no longer includes "Team"
  - All Site Mode imports of TeamTab/TeamFormDrawer updated; nothing 404s
- No `OrgSettingsDrawer` references remain in the codebase (grep is clean)

## Follow-up plans this sequence absorbs

- `plans/kiara/protocol-collaboration.md` — will be reworked as the org-chat-channels plan (PR 2 / PR 3) rather than a separate per-protocol surface. Status flips to `superseded` once PR 1 lands and PR 2 starts.
