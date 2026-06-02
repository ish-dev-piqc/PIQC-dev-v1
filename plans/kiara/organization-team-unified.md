---
owner: ki-dev-piqc
feature: organization-team-unified
status: active
started: 2026-06-01
target_pr:
---

# Unified Team tab: one row per protocol member, two badges per row

## Context

The current Team tab on the Organization page has two stacked sections:

1. **PIQC team** — joined view of `protocol_members` (app access roles)
2. **Site delegation log** — `site_team_members` (clinical-trial regulatory
   roster with cert tracking)

Same protocol, two lists, often the same people. The split is logically
correct (different tables, different concerns) but visually redundant.
Users see Maya in both lists and don't know which one to act on. The
delegation log section feels useless because it's just "Maya again, with a
cert date this time."

## Design

### One row per person on the protocol

The Team tab becomes a single unified list. Each row represents one person
on the active protocol, joined across both tables by email (the only field
both tables share):

- **Name + email** — from `user_profiles` if the row originates from
  `protocol_members`, otherwise from `site_team_members` directly.
- **PIQC role badge** — Coordinator / Team member / Viewer if the person has
  PIQC access. "Admin (implicit)" if the person is an org admin. "—" (muted)
  if they're only in the delegation log.
- **Clinical role badge** — PI / SUB_I / COORDINATOR / NURSE / PHARMACIST /
  MONITOR if the person has a `site_team_members` row. "Not in delegation
  log" (muted) if they only have PIQC access.
- **Cert status chip** (when applicable) — green if cert is current, amber
  if expiring within 30 days, red if expired. Hidden when there's no
  delegation log row.

Some rows have both badges populated. Some have only PIQC (account exists
but isn't yet in the delegation log). Some have only clinical (pharmacist
who doesn't use PIQC). Org admins always show a PIQC badge (implicit
access) and may or may not have a clinical role.

### Inline editing with confirm-on-every-change

For site administrators each badge becomes editable inline:

- **PIQC role badge** — a small `<select>`. On change, a confirmation
  modal opens: "Change Maya's PIQC role from Team member to Coordinator?"
  with Yes / Cancel. Confirm runs `updateProtocolMemberRole`. If the
  person doesn't yet have PIQC access, the badge reads "—" and clicking it
  opens a small popover with role choices that, on confirm, call
  `addProtocolMember`.
- **Clinical role badge** — clicking it opens `TeamFormDrawer` in edit
  mode (existing behavior). Saving runs `updateTeamMember`. If the row
  doesn't exist yet, clicking opens the drawer in create mode (newly
  wired in this PR — see below).

Confirm-on-every-change applies to PIQC role transitions in both
directions. Picking the same role re-submits a no-op (and the modal
detects equal values and self-dismisses). Clinical-role changes already
go through the drawer's save flow, which is its own confirm gesture, so
no additional modal.

### TeamFormDrawer: enable create mode

The drawer's create mode is currently a static "self-serve add isn't
available" panel — leftover constraint from before site admins existed.
This PR removes that stub: create mode renders the same form as edit
mode, with `createTeamMember` as the submit target. Validation reuses the
existing checks (name required, email format if provided). This lets an
admin add a clinical-only staff member (the pharmacist who isn't a PIQC
user) directly from the Team tab.

### Drop ProtocolMembersList.tsx

Its function is absorbed into the new unified list. Delete it.

### Don't touch TeamTab.tsx

That file still renders the full standalone delegation log used by
`Dashboard.tsx`'s defensive `case 'team'` branch. Leaving it alone keeps
this PR's blast radius contained — the case is dead in the tab strip but
TodayTab still navigates to `'team'` for cert warnings. Re-routing that
navigation to the Organization page is a separate follow-up.

### Per-row admin actions (compact)

A small `⋯` menu on each row collapses the row-level admin actions:

- "Remove PIQC access" — only if the person has a PIQC role; runs
  `removeProtocolMember`.
- "Edit clinical role" — opens TeamFormDrawer in edit mode (or create if
  none yet). Equivalent to clicking the clinical badge directly; the menu
  entry exists for keyboard / screen-reader users who might not realize
  the badge is clickable.
- "Remove from delegation log" — only if the person has a clinical role;
  runs `deleteTeamMember`.

Two-step confirms via `window.confirm` for each remove. (Modal confirm is
overkill for remove; the role-change modal is justified because role
changes are reversible and the user wants to see what they're picking.)

## Scope (files allowed)

### New

- `src/components/dashboard/organization/team/UnifiedTeamList.tsx` (NEW) —
  fetches `protocol_members` + `org_members_with_profile` + the active
  protocol's `site_team_members` (via `useSiteData`) and joins them by
  email into a single list. Renders the unified rows with inline edit +
  confirm modal + per-row admin menu.
- `plans/kiara/organization-team-unified.md` — this file.

### Modified

- `src/components/dashboard/organization/OrganizationPage.tsx` — Team tab
  content becomes `<UnifiedTeamList protocolId={activeProtocol.id} />`.
  Drops the "PIQC team / Site delegation log" two-section structure and
  the `<TeamTab />` render. Drops the import of `ProtocolMembersList`.
- `src/components/dashboard/organization/team/TeamFormDrawer.tsx` — enable
  create mode: drop the static "self-serve add isn't available" panel and
  render the form, wired to `createTeamMember` on submit. The existing
  edit branch is unchanged.

### Deleted

- `src/components/dashboard/organization/team/ProtocolMembersList.tsx` —
  obsoleted by UnifiedTeamList.

### Out of scope (forbidden)

- `src/components/dashboard/organization/team/TeamTab.tsx` — left alone.
  Still used by `Dashboard.tsx`'s defensive `case 'team'` fallback and by
  TodayTab's cert-warning navigation target. A follow-up PR can re-route
  TodayTab to open the Organization → Team tab directly and then delete
  TeamTab.tsx.
- `src/lib/orgs/orgsApi.ts`, `src/lib/site/siteApi.ts` — no new endpoints
  needed. Uses existing `addProtocolMember`, `updateProtocolMemberRole`,
  `removeProtocolMember`, `listProtocolMembers`,
  `listOrgMembersWithProfile`, `createTeamMember`, `updateTeamMember`,
  `deleteTeamMember`.
- `supabase/migrations/**` — no DB change.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component
- [ ] test

## Mock data plan

None. UnifiedTeamList queries the same APIs as the components it replaces.

## Approved-by

Self-only — all files in Kiara's domain (`src/components/dashboard/organization/`).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `npx vitest run` → existing tests pass
- `grep -r "ProtocolMembersList" src/` → no matches after delete
- Manual, as site member:
  - Team tab → unified rows; each shows name + PIQC badge + clinical badge
  - Pure-PIQC user (added via Manage, not yet in delegation log) → clinical
    badge reads "Not in delegation log"
  - Pure-clinical user (pharmacist) → PIQC badge reads "—"
  - Badges are read-only (no caret / cursor)
- Manual, as site administrator:
  - PIQC badge: clicking → role select; picking a different role → confirm
    modal; Yes → role updates, banner shows new role
  - Same-role pick → no-op, modal auto-dismisses
  - "—" badge (no PIQC access yet) → click → role popover, confirm →
    person added to `protocol_members`
  - Clinical badge: clicking → TeamFormDrawer opens in edit mode if there's
    a row, create mode otherwise
  - Create mode: form is editable (no "self-serve add" stub); submitting
    creates a `site_team_members` row tied to the active protocol
  - ⋯ menu: Remove PIQC access, Edit clinical, Remove from delegation log
    each work and confirm via `window.confirm`
- Empty state: protocol with no members → "No team on this protocol yet."
  with admin pointer to Manage tab
