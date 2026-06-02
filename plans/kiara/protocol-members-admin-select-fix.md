---
owner: ki-dev-piqc
feature: protocol-members-admin-select-fix
status: active
started: 2026-06-01
target_pr:
---

# Fix: site admins can't SELECT protocol_members on their own org's protocols

## Context

Live testing of the new PIQC team section on the Organization → Team tab
surfaced an asymmetric RLS bug. The original SELECT policy on
`protocol_members` (in migration `20260618000000_protocol_members_table.sql`)
restricts reads to rows where the caller is themselves a member of that
protocol:

```sql
CREATE POLICY "protocol_members_member_select" ON public.protocol_members
  FOR SELECT TO authenticated
  USING (protocol_id IN (SELECT public.current_user_protocol_ids()));
```

That's correct for a coordinator/member/viewer's own visibility. But it
locks site admins out of every protocol they don't personally sit on —
an org admin has *implicit* access to every protocol owned by their org
via `user_can_access_protocol` + the org-admin org-wide-access path
(migration `20260618000800_user_can_access_protocol_site_admin.sql`)
without ever appearing in `protocol_members` directly. The modify policy
on the same table already includes an org-admin clause, so the asymmetry
was hidden until the new ProtocolMembersList queried the rows for display.

Symptom: bulk picker successfully inserts `protocol_members` rows, but
the admin who triggered the bulk add then sees an empty "PIQC team"
section because their own SELECT returns zero rows.

## Design

Drop and recreate the SELECT policy to mirror the existing modify policy's
admin clause:

```sql
DROP POLICY IF EXISTS "protocol_members_member_select" ON public.protocol_members;

CREATE POLICY "protocol_members_member_select" ON public.protocol_members
  FOR SELECT TO authenticated
  USING (
    protocol_id IN (SELECT public.current_user_protocol_ids())
    OR EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = protocol_members.protocol_id
        AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
    )
  );
```

The EXISTS subquery is the exact admin-clause shape already used by
`protocol_members_coordinator_modify` on the same table — any recursion
risk would already manifest there on every write. None observed in
practice (the policy has been in place since the original table
migration), so the same pattern is safe to reuse on SELECT.

## Scope (files allowed)

### New

- `supabase/migrations/20260623000000_protocol_members_admin_select.sql` — RLS policy fix.
- `plans/kiara/protocol-members-admin-select-fix.md` — this file.

### Out of scope (forbidden)

- TS / component changes — the `ProtocolMembersList.tsx` code is already
  correct; it just gets an empty array back from RLS. No UI change needed
  once the policy is fixed.
- The modify policy — already includes the admin clause; no edit there.
- Adjusting `current_user_protocol_ids` / `current_user_admin_org_ids` —
  those are existing SECURITY DEFINER helpers and are used as-is.

## Architecture layers touched

- [x] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test

## Mock data plan

None.

## Approved-by

- `@rg-dev-piqc` — `supabase/**` is in Roger's domain per CODEOWNERS. Single
  RLS policy adjustment that mirrors an existing admin clause already
  proven on the modify path; minimal blast radius.

## Verification

- `npx supabase db push --project-ref ygfcjwgsjmathinqkppq` succeeds against
  the dev project.
- Manual, as site administrator, no explicit protocol_members row for self:
  - Bulk-add a non-admin user (Maya) to PP06489 via Manage → bulk picker
  - Go to Team tab, pick PP06489 → "PIQC team" section shows Maya
  - Previously (before this fix) the same flow showed Maya disappearing
    from the list immediately after the insert succeeded
- Manual, as a non-admin coordinator on PP06490:
  - Team tab → PIQC team list still works (regression check; my own
    membership row still grants access)
- DB-level check: as a Postgres role with site_admin org membership, run
  `SELECT * FROM protocol_members WHERE protocol_id = '...'` for an
  org-owned protocol → rows return.

## No type impact

The migration changes only an RLS policy; no schema change, no new
columns, no new functions. `src/types/orgs/` is unaffected.
