---
owner: ki-dev-piqc
feature: create-org-invite-ambiguous-id
status: active
started: 2026-05-30
target_pr:
---

# `create_org_invite` ambiguous column fix

## Context

Third instance of the same PL/pgSQL ambiguity pattern. The org-drawer "Create invite + copy link" button calls `create_org_invite(p_org_id, p_email, p_role, p_protocol_assignments)`. When a protocol assignment is included, the function's inner check

```sql
SELECT 1 FROM public.protocols
WHERE id = v_protocol_id AND owner_org_id = p_org_id
```

errors with `42702 column reference "id" is ambiguous`. The function's `RETURNS TABLE (id UUID, token TEXT, expires_at TIMESTAMPTZ)` declaration creates an OUT parameter named `id` that PL/pgSQL exposes as a variable in the body. The bare `id` reference could be either the OUT variable or `protocols.id` — Postgres rejects the ambiguity at execution.

Same root cause as the two previous fixes that already landed:
- `20260619000000_list_org_invites_qualify_columns.sql` (PR #182)
- `20260619100000_accept_org_invite_drop_recreate.sql` (PR #184)

PL/pgSQL only catches the ambiguity at first execution, which is why the original migration (`20260618000900`) applied cleanly and the bug lurked until a real invite was created with assignments.

## Scope (files allowed)

- `supabase/migrations/20260619200000_create_org_invite_qualify_columns.sql` (NEW) — `CREATE OR REPLACE` of `create_org_invite` with all column references qualified (`protocols.id`, `org_members.org_id`, etc.). No schema change; return shape unchanged.
- `plans/kiara/create-org-invite-ambiguous-id.md` — this file.

## Out of scope (files forbidden)

- Any `src/` file — pure DB-side fix. Application code already calls the function with the same parameters.
- Other Ishika RPCs — no other ambiguous patterns surfaced by usage so far. If a fourth surfaces, separate PR.

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

- `@rv61` — for `supabase/migrations/20260619200000_create_org_invite_qualify_columns.sql`. Pure function-body fix qualifying ambiguous column references; no schema change, no return-shape change.

## Verification

- Apply the migration to staging.
- Reload the org settings drawer; fill the invite form with email + role + at least one protocol assignment; click "Create invite + copy link". Should succeed without a `42702` error and copy a token URL to the clipboard.
- Run an invite-with-zero-assignments and an invite-with-multiple-assignments to confirm both paths still work.
- Check the `org_invites` table — the new row should have `protocol_assignments` populated correctly as JSONB.
