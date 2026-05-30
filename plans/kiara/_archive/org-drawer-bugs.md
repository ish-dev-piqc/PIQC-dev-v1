---
owner: ki-dev-piqc
feature: org-drawer-bugs
status: merged
merged: 2026-05-30
started: 2026-05-30
target_pr: #182
---

# Org drawer bugs — fix three failing calls + improve error rendering

## Context

The org settings drawer (now at `src/components/dashboard/orgs/OrgSettingsDrawer.tsx`) opens after a real login but shows `[object Object]` as the error and an empty members roster. Three independent calls were failing concurrently in the browser console, all surfacing as HTTP 400s from Supabase, and all rendering as `[object Object]` because the existing `fail()` helper in `orgsApi.ts` couldn't unpack a PostgrestError.

## Diagnosis (from the browser console)

1. **`list_org_invites` RPC** — `code: 42702`, `"column reference 'role' is ambiguous"`. The function declares `RETURNS TABLE (..., role TEXT, ...)`; PL/pgSQL exposes those OUT names as variables in the function body. Inside the admin-check `IF EXISTS (SELECT 1 FROM org_members WHERE ... AND role = 'admin')`, the bare `role` reference is ambiguous between the OUT variable and `org_members.role`. Pre-existing bug from Ishika's PR #95 — the function compiled fine on insert but errors lazily at first call.

2. **`listOrgMembersWithProfile`** — `code: PGRST200`, `"Could not find a relationship between 'org_members' and 'user_profiles' in the schema cache"`. The query used `user_profiles!inner(name)` to embed-join. PostgREST needs a direct FK between the two tables to do that. There isn't one — they each FK to `auth.users(id)` independently, which PostgREST doesn't treat as a transitive relationship.

3. **`listProtocolsByOrg`** — 400. The function queried `protocols.code, name, sponsor`, but the DB columns are `study_number` and `title`; `Protocol.code` / `Protocol.name` are frontend aliases set elsewhere when protocols load. My bug from the org-workspaces PR.

Plus a meta-bug surfacing all three: `fail()` did `error instanceof Error ? error.message : String(error)`. PostgrestError is a plain object, not `Error`, so `String(error)` produces `[object Object]`.

## Scope (files allowed)

- `src/lib/orgs/orgsApi.ts` — fix `fail()` to unpack PostgrestError; rewrite `listOrgMembersWithProfile` to two queries + client-side join; alias columns in `listProtocolsByOrg` to match the DB schema.
- `supabase/migrations/20260619000000_list_org_invites_qualify_columns.sql` (NEW) — `CREATE OR REPLACE` the function with `org_members.role` qualified in the admin check. No schema change.
- `plans/kiara/org-drawer-bugs.md` — this file.

## Out of scope (files forbidden)

- Anything else in `src/lib/orgs/`, `src/components/dashboard/orgs/`, `src/context/`, `src/types/orgs/` — none are touched.
- The other org-workspaces migrations (`20260618000000`–`20260618001000`) — none are modified or replaced.
- `src/lib/orgs/__tests__/` — existing tests cover the unchanged surface; the rewrites are functionally equivalent at the API contract level and don't require new test cases.

## Architecture layers touched

- [x] migration (1 new file; `CREATE OR REPLACE` of pre-existing function)
- [ ] RPC (no new RPCs)
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test

## Mock data plan

None.

## Approved-by

- `@rv61` — for `supabase/migrations/20260619000000_list_org_invites_qualify_columns.sql`. Pure function-body fix to qualify ambiguous column references; no schema change.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `npx vitest run src/lib/orgs/__tests__/` → all green (no API contract changes)
- Apply the new migration to staging; reload the org settings drawer:
  - Members roster loads (was empty)
  - Invites list loads (was 400)
  - Protocol-assignment picker in the invite form loads (was 400)
  - No `[object Object]` banner
- If any new error fires, the banner now shows the actual PostgrestError `message` rather than `[object Object]`.
