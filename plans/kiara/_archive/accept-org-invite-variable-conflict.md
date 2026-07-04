---
owner: ki-dev-piqc
feature: accept-org-invite-variable-conflict
status: merged
merged: 2026-05-31
started: 2026-05-30
target_pr: #194
---

# `accept_org_invite` — add `#variable_conflict use_column` directive

## Context

Fourth PL/pgSQL ambiguity in the org RPC family. When a recipient clicks an invite link, `accept_org_invite(p_token)` runs and errors with `42702 column reference "org_id" is ambiguous`.

Different surface area than the previous three fixes (`list_org_invites`, `accept_org_invite` drop+recreate, `create_org_invite`):

- The function declares `RETURNS TABLE (org_id UUID, org_name TEXT, role TEXT, protocol_count INTEGER)`, which exposes those names as OUT variables in the function body.
- The body does `INSERT INTO public.org_members (org_id, user_id, role) VALUES (…) ON CONFLICT (org_id, user_id) DO UPDATE SET role = …`.
- `org_id` and `role` in the INSERT column list, ON CONFLICT target, and SET clause are ambiguous between the OUT variables and the target table's columns.

Unlike the previous fixes, **explicit qualification doesn't apply here** — `INSERT INTO foo (foo.bar, …)` isn't valid SQL, and `ON CONFLICT (foo.bar, …)` rejects the qualified form too. The clean fix is the PL/pgSQL directive `#variable_conflict use_column`, which tells the parser to resolve any ambiguous reference in favor of the column.

Behavior-equivalent for this function: the OUT params are only consumed by the final `RETURN QUERY SELECT v_org.id, v_org.name, v_invite.role, v_count` (explicit local-variable values, not OUT names).

## Scope (files allowed)

- `supabase/migrations/20260619300000_accept_org_invite_variable_conflict.sql` (NEW) — `CREATE OR REPLACE` of `accept_org_invite` adding `#variable_conflict use_column` at the top of the function body. Return shape unchanged from `20260619100000`; pure body update.
- `plans/kiara/accept-org-invite-variable-conflict.md` — this file.

## Out of scope (files forbidden)

- Other RPCs — none of `create_org_invite`, `list_org_invites`, `approve_protocol_access_request`, or `accept_protocol_guest_invite` currently exhibit the INSERT/ON CONFLICT clash. If they surface, separate PR.
- Any `src/` file — pure DB-side fix.

## Architecture layers touched

- [x] migration (1 new file; `CREATE OR REPLACE` of an existing function)
- [ ] RPC (no new RPCs)
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test

## Mock data plan

None.

## Approved-by

- `@rv61` — for `supabase/migrations/20260619300000_accept_org_invite_variable_conflict.sql`. Pure function-body fix using the PL/pgSQL `#variable_conflict use_column` directive; no schema change, no return-shape change.

## Verification

- Apply migration to staging.
- From an incognito browser, paste an invite token URL; sign in. `accept_org_invite` runs on dashboard load. Should succeed without `42702` error.
- Confirm: `org_members` has a row for the accepting user; `protocol_members` rows added for each assignment in the invite's `protocol_assignments` JSONB; `org_invites.used_at` is populated.
- Existing tests in `src/lib/orgs/__tests__/orgsApi.test.ts` continue to pass — they don't directly exercise the RPC body (mocks supabase), only the call surface.
