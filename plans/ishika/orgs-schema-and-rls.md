---
owner: ish-dev-piqc
feature: orgs-schema-and-rls
status: in-review
started: 2026-05-18
target_pr: 94
---

# Orgs FK table + scoped RLS — replace free-text `owner_org` matching

## Context

PR #90 (B1) added `protocols.owner_org` as a free-text mirror of `user_profiles.organization`. RLS uses `owner_org = (SELECT organization FROM user_profiles ...)` which works but breaks the moment a user has a trailing space, capitalisation drift, or typo in their organization name. The master plan §9.0a flagged this as the v1 simplification and Track C as the follow-up.

This PR is **Track C1-schema**: real `orgs` and `org_members` tables, backfilled from existing data, with RLS rewritten to use `owner_org_id` and org membership lookups. App-code changes are **minimal** thanks to two BEFORE-INSERT triggers that auto-resolve `org_id` / `owner_org_id` from the free-text fields. Existing flows (ProfileCompletion writing `organization`, B1's protocol inserts writing `owner_org`) continue to work unchanged.

The org management UI (invite flow, admin role changes, switch-org picker) is **C1-UI** in the next PR.

## Scope (files allowed)

- `supabase/migrations/20260520000000_orgs_schema_and_user_profiles_link.sql` (NEW)
- `supabase/migrations/20260520000100_protocols_owner_org_id.sql` (NEW)
- `supabase/migrations/20260520000200_owner_scoped_rls_v2.sql` (NEW)
- `plans/ishika/orgs-schema-and-rls.md`

## Out of scope (files forbidden)

- All `src/` files. Triggers auto-resolve org references; app code keeps working unchanged.
- C1-UI (org settings page, invite flow) — separate PR
- C2 cross-org collaboration (multi-party access) — separate PR
- Dropping `protocols.owner_org` or `user_profiles.organization` columns — keep them for back-compat through Track C; future cleanup PR after all consumers migrate

## Architecture layers touched

- [x] migration (3 new files)
- [x] RPC (resolver trigger functions, RLS policies)
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test

No `src/types/<domain>/` impact.

## Mock data plan

None. Pure backend. Demo mode unaffected (fixtures never hit Supabase).

## Approved-by

- @rv61 — `supabase/migrations/**` is Roger's domain.

## Verification

### Schema + backfill

- [ ] `SELECT count(*) FROM orgs` ≥ number of distinct trimmed `user_profiles.organization` values
- [ ] `SELECT count(*) FROM org_members` = number of users with non-empty `organization`
- [ ] `SELECT count(*) FROM user_profiles WHERE org_id IS NULL AND organization IS NOT NULL` = 0
- [ ] `SELECT count(*) FROM protocols WHERE owner_org_id IS NULL` = 0
- [ ] First user (by `user_profiles.created_at`) of each org is `role='admin'`; others `'member'`

### RLS isolation

- [ ] User A and user B in different orgs sign in via PostgREST — neither sees the other's protocols
- [ ] Users in same org see each other's protocols + can modify org-mate visits/team rows
- [ ] Only owner can modify their own protocol metadata (owner_id check still holds)

### Triggers

- [ ] Insert a new user via ProfileCompletion with a new org name → org is created automatically + user is added as admin
- [ ] Insert a new user with an existing org name → user is added as member
- [ ] B1/B2 code paths that write `protocols.owner_org` still work — `owner_org_id` gets auto-populated by the trigger from the org-name lookup
