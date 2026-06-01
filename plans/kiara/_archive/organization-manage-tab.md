---
owner: ki-dev-piqc
feature: organization-manage-tab
status: merged
merged: 2026-06-01
started: 2026-06-01
target_pr: #214
---

# Organization page — Manage tab + Team protocol picker + read-only Members

## Context

After the page-polish PR (#follow-up to #204) Kiara surfaced three remaining UX issues:

1. **Members tab muddles two concerns.** It shows the org roster (everyone wants to see it) AND the admin controls (invite, remove, protocol assignment). Mixing them makes the read action and the destructive action live in the same place. Non-admins also see admin-flavored sections they can't use.
2. **Team tab is locked to the navbar's active protocol.** No way to look at a coworker's protocol without first switching the whole app. Users want to skim "who's on protocol X" without doing a full mode switch.
3. **No way to bulk-assign access.** Today, putting five people on a protocol means five separate clicks. Inverse — putting one person on three protocols — is also tedious. Real workflow is "I just hired Maya, put her on PP06489, PP06490, and PP06491" or "PP06492 just kicked off, put Maya, Sam, and Jordan on it."

## Design

### Three tabs (in this order)

**Members (everyone, read-only)** — pure roster. List of org members with name + role badge (Site administrator vs Site member). No invite form, no remove, no protocol assignment. If the viewer is an admin, a one-liner appears at the top: "To invite, remove, or manage protocol access, use the Manage tab." Non-admins don't see the pointer.

**Team (everyone)** — existing Site-Mode delegation log (PI / Coordinator / Nurse / certifications / delegated tasks), unchanged. The new addition is an in-page protocol picker at the top of the tab. The picker is a `<select>` populated from `useProtocol().protocols` (the user's accessible protocols — already filtered by RLS). Picking a different option calls `setActiveProtocol(...)`, which swaps the global active protocol. Consequence: when the user clicks "← Dashboard" after browsing, the dashboard returns to the protocol they last looked at. This is a deliberate design choice — keeps the data layer simple (no shadow protocol state in `useSiteData`) and matches the natural mental model ("I switched my focus to PP06490").

**Manage (admin-only)** — three sections, top-to-bottom:

1. **Invite to organization** (lifted from the old MembersTab) — email + role select + per-protocol assignment checkboxes + Create invite button. Pending invites list with copy-link + cancel.
2. **Manage members** — table-style roster with per-row Remove button and a role-toggle button (Make admin / Make member). This is what currently lives in MembersTab; just moves here.
3. **Bulk protocol access** — two-list checker.
   - **Left column**: org members with checkboxes (excluding site administrators, who have implicit access to every protocol — including them in the picker would create meaningless `protocol_members` rows).
   - **Right column**: org protocols with checkboxes (code + name).
   - Each column header shows the selection count and "Select all" / "Clear" links.
   - Below both lists, an action bar: Role select (Team member / Coordinator / Viewer; default Team member), live count of new vs. already-assigned pairs ("3 new assignments, 1 already assigned"), and a primary "Add to selected protocols" button.
   - Submitting takes the cartesian product of selected members × selected protocols, splits into "new" (not yet a `protocol_members` row) and "already assigned", and fires `addProtocolMember` for each new pair in parallel via `Promise.all`. Already-assigned pairs are skipped client-side, not sent.
   - Result banner below the action bar shows what happened — added pairs listed individually ("Maya → PP06489, Sam → PP06490"), skipped pairs with reason "Already assigned", and any failures with their server error. Dismissable.
   - **Removing** access is intentionally NOT in the bulk surface — that stays per-row in the Team tab where the user has the protocol context in front of them. Bulk removal is rare enough not to warrant a second selection mode; the two-list UI stays single-purpose.
   - Role changes to existing assignments are likewise out of scope here; they live on Team tab per-row via `updateProtocolMemberRole`.

### What stays in MembersTab.tsx

After this PR, MembersTab is small: just the read-only roster + the scope-helper subhead. All admin actions live in Manage.

## Scope (files allowed)

### New

- `src/components/dashboard/organization/ManageTab.tsx` — full new component. Invite form + pending invites + member-remove rows + bulk matrix.
- `plans/kiara/organization-manage-tab.md` — this file.

### Modified

- `src/components/dashboard/organization/OrganizationPage.tsx` — add `'manage'` to OrgTab union; render `ManageTab` when active; only show the Manage tab pill to admins (`activeOrg.my_role === 'admin'`). Team tab: render the new protocol-picker `<select>` above `<TeamTab />` content; on change, call `setActiveProtocol(p)`. Drop the scope-helper "Protocol team" wrapper if redundant after picker (keep the subhead pointing at Members).
- `src/components/dashboard/organization/MembersTab.tsx` — strip invite form, pending-invites list, role-toggle buttons, remove buttons, and the entire admin-only section. Keep only the roster + role badges + scope-helper subhead. Add the admin pointer at top ("To invite, remove, or manage protocol access, use the Manage tab.").

### Out of scope (forbidden)

- Touching `src/components/dashboard/site/TeamTab.tsx` — keep the Site Mode delegation log unchanged. The in-page picker lives in OrganizationPage.tsx and uses `setActiveProtocol` from the existing ProtocolContext; no TeamTab signature change.
- Modifying `src/lib/orgs/orgsApi.ts` — the existing `addProtocolMember`, `removeProtocolMember`, `listProtocolMembers` are sufficient. Bulk operation is implemented client-side via `Promise.all`. (No new API → no new sibling test required by the mechanical check.)
- `supabase/migrations/**` — no DB change.
- Chat / Activity log tabs — still future PRs.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component
- [ ] test (no new API; existing orgsApi tests cover the underlying calls)

## Mock data plan

None. Matrix queries `listProtocolMembers` per org protocol on mount.

## Approved-by

Self-only — `src/components/dashboard/organization/` is in Kiara's domain via the Site/Org area she owns. `OrganizationPage.tsx` reads from `useProtocol()` (cross-domain) but only for already-public values + `setActiveProtocol`; no new coupling.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `npx vitest run` → existing tests pass; no new tests required (no API changes)
- Manual, as site member:
  - Members tab: roster visible, no controls, no admin pointer
  - Team tab: protocol dropdown defaults to the navbar's active protocol; selecting a different protocol updates the team display AND the navbar's active-protocol selector
  - Manage tab: hidden / not in the tab strip
- Manual, as site administrator:
  - Members tab: roster visible, admin pointer visible at top
  - Manage tab: visible. Invite form works (parity with old MembersTab invite). Pending invites work. Per-row Remove works.
  - Bulk matrix: shows current `protocol_members` state for every (member, protocol) pair. Toggling cells updates the local delta count. Apply Changes commits the deltas via parallel `addProtocolMember` / `removeProtocolMember` calls. Cancel reverts. Errors surface in a banner.
  - After Apply, Team tab for an affected protocol shows the added member.
