---
owner: ki-dev-piqc
feature: wire-request-access-button
status: merged
merged: 2026-05-31
started: 2026-05-30
target_pr: #202
---

# Wire `RequestAccessButton` into the protocol picker

## Context

A site member invited without protocol assignments can see protocol names in the picker (metadata-public-within-org) but has no in-app way to request access. The `RequestAccessButton` component already exists (built in the org-workspaces PR) but isn't rendered anywhere.

This PR wires it into the Navbar's protocol picker: protocols are split into "Your protocols" (member or admin) and "Available in your org" (visible but not a member). The latter section renders each protocol with the `RequestAccessButton` next to it.

## Design

- New `listMyProtocolMemberships()` in `orgsApi.ts` — returns the set of `protocol_id`s the current user has an explicit `protocol_members` row for.
- `OrgContext` loads it on mount + auth change; exposes `myProtocolIds: Set<string>`. No realtime (v1) — refresh on next page load if a coordinator adds you mid-session.
- `Navbar` picker splits visible protocols using the rule:
  - If user is an admin in ANY of their orgs → treat all visible protocols as "yours" (coarse — breaks in the rare multi-org admin/member-mix case)
  - Else → "yours" = protocols in `myProtocolIds`; "available" = the rest
- "Available in your org" rows are non-clickable (no `setActiveProtocol`) and render an inline `RequestAccessButton`. Visual styling is dimmed vs. the "yours" rows (60–70% opacity on text + dot) so the distinction is obvious.

## Scope (files allowed)

- `src/lib/orgs/orgsApi.ts` — add `listMyProtocolMemberships()`.
- `src/context/OrgContext.tsx` — add `myProtocolIds: Set<string>` state, loader effect, and value.
- `src/components/Navbar.tsx` — import `useOrg` + `RequestAccessButton`; refactor the picker's `protocols.map` into a split (Your / Available) IIFE; render `RequestAccessButton` inline on each available row.
- `src/lib/orgs/__tests__/orgsApi.test.ts` — extend the protocol-members exports check to include `listMyProtocolMemberships`.
- `plans/kiara/wire-request-access-button.md` — this file.

## Out of scope (files forbidden)

- `RequestAccessButton.tsx` itself — already implements the form + pending/approved/denied states correctly. No changes needed for this wiring.
- `supabase/migrations/**` — no DB change. RLS on `protocol_members` already permits a user to read their own rows.
- The "site admin in one org, member in another" edge case — using a coarse "isAnyOrgAdmin → all-mine" rule for v1. Refine when multi-org-mixed-role users actually exist.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [x] context (OrgContext extended)
- [x] component (Navbar picker refactor)
- [x] test (orgsApi exports check)
- [x] util (orgsApi new function)

## Mock data plan

None.

## Approved-by

- `@ish-dev-piqc` — for the `src/context/OrgContext.tsx` edit (shared infra; 2-reviewer rule applies). Change is additive (new state + new loader effect) and doesn't affect any existing context value.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `npx vitest run src/lib/orgs/__tests__/` → 27 tests pass (was 26; added `listMyProtocolMemberships` to exports check)
- Manual as a site member (kiara2 with no protocol assignments):
  - Open protocol picker → "Available in your org" section lists every PIQC protocol with a "Request access" button next to each
  - Click "Request access" → optional message → submit → pending chip replaces the button
  - From coordinator session → MembersDrawer → AccessRequestsList shows the pending request → approve
  - As kiara2: refresh → the protocol moves from "Available" to "Your protocols", becomes clickable
- Manual as a site administrator: "Available in your org" section should not appear (all org protocols show as yours)
