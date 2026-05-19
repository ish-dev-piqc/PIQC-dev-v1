---
owner: ish-dev-piqc
feature: orgs-admin-ui-and-invites
status: in-review
started: 2026-05-18
target_pr: 95
---

# Org admin UI + invite flow

## Context

C1-schema (PR #94) established the `orgs` + `org_members` data model with a free-text-resolver trigger so existing app code keeps working. This PR adds the user-facing surface: admins of an org can invite new members, manage roles, and remove people. Every org member can see the roster.

The invite flow is link-based (no email integration in v1):
1. Admin generates an invite for an email + role → server returns a shareable URL with a JWT-signed token
2. Admin sends the URL to the invitee out-of-band
3. Invitee clicks the URL → if signed in, accept-invite RPC adds them to `org_members`; if signed out, lands on Login first, then accepts on first dashboard load

Email delivery via Supabase Auth or a third party is a follow-up.

## Scope (files allowed)

- `supabase/migrations/20260520010000_org_invites_table_and_rpcs.sql` (NEW)
- `src/lib/site/repos/types.ts`
- `src/lib/site/repos/realSiteRepo.ts`
- `src/lib/site/repos/demoSiteRepo.ts`
- `src/lib/site/siteApi.ts`
- `src/components/dashboard/site/OrgSettingsDrawer.tsx` (NEW)
- `src/components/Navbar.tsx` (add "Organization" entry in user dropdown)
- `src/App.tsx` (accept-invite handling on dashboard load if `?invite=<token>` URL param)
- `plans/ishika/orgs-admin-ui-and-invites.md`

## Out of scope (files forbidden)

- Email delivery (Resend / Supabase Auth invite). v1 ships a copy-link affordance only.
- Switch-org picker for users in multiple orgs. RLS allows seeing protocols from all memberships already — UX upgrade for a later PR.
- C2 cross-org collaboration (protocol-level multi-party access). Separate scope.
- F1 `is_demo_user` admin UI. Separate scope.

## Architecture layers touched

- [x] migration (1 new file — table + 5 RPCs)
- [x] RPC
- [x] adapter (repo additions)
- [ ] context
- [x] component (NEW drawer + Navbar wire-up)
- [ ] test

No `src/types/<domain>/` impact.

## Mock data plan

None for production paths. Demo mode org operations are no-ops (demo never hits the org tables) — the drawer shows a "Demo mode — org settings are read-only" banner in demo mode.

## Approved-by

- @rv61 — migration + RPCs
- @ki-dev-piqc — site lib + components

## Verification

- [ ] Sign in as the admin of an org → user dropdown shows "Organization" → drawer opens with member list
- [ ] Click "Invite member" → fill email + role → submit → shareable link copied to clipboard + visible in pending-invites list
- [ ] Sign out, visit the URL → land on Login → sign in → on dashboard load, invite is auto-accepted, you appear in the org's `org_members`
- [ ] Admin changes another member's role → applies; the affected member sees the change on next refresh
- [ ] Admin removes a member → row deleted from `org_members`; member no longer sees the org's protocols on next refresh
- [ ] Non-admin member: drawer renders read-only (no Invite / role-change / remove controls)
