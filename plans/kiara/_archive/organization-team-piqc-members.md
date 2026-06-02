---
owner: ki-dev-piqc
feature: organization-team-piqc-members
status: merged
merged: 2026-06-02
started: 2026-06-01
target_pr: #219
---

# Team tab: show PIQC team alongside the delegation log + fix picker width

## Context

Two issues surfaced after the Manage tab landed:

1. **Bulk-assigned members don't appear on the Team tab.** The Manage tab's
   bulk picker writes to `protocol_members` (PIQC access control: who can see
   and collaborate on the protocol inside the app). The Team tab in the
   Organization page renders Site Mode's existing TeamTab.tsx, which reads
   from `site_team_members` (the clinical-site delegation log: PI / Coordinator
   / Nurse / certifications). Same word, two tables. From a user's
   perspective, "I just added Maya to PP06489 and she's not in the team list"
   is the expected complaint — and it's right.
2. **Protocol picker dropdown overflows on narrow viewports.** The `<select>`
   sizes itself to the longest option ("PP06489 — Long Protocol Title Goes
   Here"), which runs off the right edge in split-screen.

## Design

### Team tab gains a "PIQC team" section above the delegation log

The Team tab in OrganizationPage now renders two clearly-labeled sections:

**PIQC team** (new, top) — lists `protocol_members` for the active protocol.
- Per row: avatar/icon, name, email (from `user_profiles`), PIQC role badge
  (Coordinator / Team member / Viewer).
- Admins get inline controls: a small role `<select>` to change the PIQC role
  (calls `updateProtocolMemberRole`), and a "Remove from protocol" button
  (calls `removeProtocolMember`). Non-admins see read-only rows.
- Empty state: "No PIQC users on this protocol yet. Use the Manage tab to
  add members."
- A one-line explainer at the top: "These users can see and collaborate on
  this protocol inside PIQC."

**Site delegation log** (existing, below) — the unchanged Site Mode TeamTab
content (PI / Coordinator / Nurse / certifications / delegated tasks). A
sub-header introduces it: "Site delegation log — clinical staff with their
regulatory role and certifications. Separate from PIQC access above."

The two are intentionally separate because they answer different questions:
- PIQC team: who collaborates on this protocol in the app?
- Site delegation log: who are the clinical-trial staff with their site roles
  and certs?

### Picker width fix

The protocol picker wraps onto its own row when the viewport gets narrow and
caps at a sensible max-width. Selected-option text truncates with the
browser's native ellipsis. Dropdown menu still opens to the option list at
full text length so the user can read the full name when picking.

Concretely: wrap the label+select pair in a `flex flex-wrap items-center
gap-2`; the `<select>` gets `max-w-full w-full sm:max-w-[320px]`. On mobile/
split screen the select takes the full row width below the label; on wider
viewports it sits inline next to the label, capped at 320px so it never
runs off.

## Scope (files allowed)

### New

- `src/components/dashboard/organization/team/ProtocolMembersList.tsx` (NEW) —
  fetches `protocol_members` + `org_members_with_profile` for the active
  protocol, joins them client-side, renders the list with admin controls.
- `plans/kiara/organization-team-piqc-members.md` — this file.

### Modified

- `src/components/dashboard/organization/OrganizationPage.tsx` — wraps the
  Team tab content with the new `ProtocolMembersList` above the existing
  `TeamTab`; adds a "Site delegation log" sub-header between them; fixes
  the protocol picker width via flex-wrap + max-width.

### Out of scope (forbidden)

- `src/components/dashboard/organization/team/TeamTab.tsx` — the delegation
  log stays exactly as it is. No behavior change.
- `src/lib/orgs/orgsApi.ts` — uses existing `listProtocolMembers`,
  `listOrgMembersWithProfile`, `updateProtocolMemberRole`, `removeProtocolMember`.
- `supabase/migrations/**` — no DB change.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (new ProtocolMembersList + OrganizationPage edit)
- [ ] test

## Mock data plan

None.

## Approved-by

Self-only — all files in Kiara's domain.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual, as site member:
  - Team tab → PIQC team section lists protocol_members with name, role badge;
    no controls
  - Picker on narrow viewport: wraps below the label; doesn't overflow the page
- Manual, as site administrator:
  - Team tab → PIQC team section visible; inline role select + Remove button on
    each row
  - Change a role → updates immediately (server + UI)
  - Remove → confirms, removes from `protocol_members` (member loses access)
  - Adding via Manage tab → member appears in PIQC team section after the
    list refresh (or after navigating away and back)
