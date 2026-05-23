---
owner: ish-dev-piqc
feature: protocols-ownership-rls
status: merged
merged: 2026-05-23
started: 2026-05-18
target_pr: #90
---

# Multi-tenancy foundation: delete demo seed + add owner_id/owner_org + scoped RLS

## Context

PR #85 shipped Demo Mode but didn't touch the elephant in production: the seed migration `20260506000200_seed_site_mode_demo.sql` is deployed, so every real signup currently sees BRIGHTEN-2 / CARDIAC-7 / IMMUNE-14 + their participants/visits/team. Site-mode RLS is "permissive for authenticated users" by design comment in the schema — every signed-in user can read and write every other user's data. Both problems get fixed here.

This is the **foundation PR** for Track B. Onboarding entry points (B2), reliability fixes (B3), and gap-fill CRUD (B4) all depend on the columns and policies this PR adds.

Strategy doc: `.claude/plans/goal-complete-production-greedy-thunder.md` §9.0a.

## Scope (files allowed)

- `supabase/migrations/20260519000000_delete_demo_seed_protocols.sql` (NEW)
- `supabase/migrations/20260519000100_protocols_ownership.sql` (NEW)
- `supabase/migrations/20260519000200_owner_scoped_rls.sql` (NEW)
- `plans/ishika/protocols-ownership-rls.md`

Timestamps moved to 2026-05-19 to dodge `20260518000000` (reserved by Roger's `feat/piqc-thread-persistence`) and our own `20260518010000` (already deployed in PR #85).

## Out of scope (files forbidden)

- All `src/` files. Zero application-code changes in this PR. The dispatcher, contexts, and components don't need to know about ownership — RLS handles scoping server-side.
- `siteApi.createProtocol` (stamp `owner_id` / `owner_org` on insert) — that's B2.2.
- Ingest function auto-create-protocol — B2.4.
- Any UI surface for adding protocols — B2.1.
- `protocols.demo_anchor_date` cleanup. The column stays for compatibility; demo mode no longer relies on real protocols anyway.
- Audit-mode, SOTR, and any other domain.

## Architecture layers touched

- [x] migration (3 new files)
- [ ] RPC
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test

No `src/types/` impact — this is a server-side scoping change, no new columns surface to the client (yet; B2 will).

## Mock data plan

None. CI-only-style change: pure backend.

## Approved-by

- @rv61 — `supabase/migrations/**` is Roger's domain per CODEOWNERS.

## Verification

### Migration safety

- [ ] `supabase migration list --linked` shows all three new migration timestamps after push, in order.
- [ ] Run a SELECT against remote to confirm seed deletion:
  ```sql
  SELECT COUNT(*) FROM protocols WHERE study_number IN ('BRIGHTEN-2', 'CARDIAC-7', 'IMMUNE-14');
  -- Expected: 0
  SELECT COUNT(*) FROM site_participants WHERE participant_code LIKE 'P-00%';
  -- Expected: 0 (FK cascade)
  ```
- [ ] `\d protocols` shows new columns `owner_id UUID NOT NULL` and `owner_org TEXT NOT NULL` with indexes.

### RLS isolation

Set up two test accounts (or sign in as two known users) with different `user_profiles.organization` values. Insert a test protocol owned by user A via direct SQL (as service_role to bypass RLS during setup):

- [ ] User A signed in via PostgREST: `SELECT * FROM protocols` returns their protocol.
- [ ] User B (different org) signed in: same query returns empty.
- [ ] User C (same org as A): same query returns A's protocol (org-mate read).
- [ ] User B attempts `UPDATE protocols ...` on A's row: returns 0 rows updated.
- [ ] `site_participants` / `site_visits` / `site_team_members` cascade-scoped: only owner+org-mates can read/write rows linked to a protocol they can access.

### Demo Mode still works

- [ ] Sign in as a demo-flagged user, flip toggle ON. The 3 demo protocols (BRIGHTEN-2 etc) still appear in the picker — because they come from `demoSiteRepo` fixtures, not from the database.

### Roll-back plan

If anything breaks:
```sql
-- Drop the three migrations in reverse order:
DROP POLICY ... ; -- (recreate the old permissive policies from 20260502000000)
ALTER TABLE protocols DROP COLUMN owner_id;
ALTER TABLE protocols DROP COLUMN owner_org;
-- Restore seed:
\i supabase/migrations/20260506000200_seed_site_mode_demo.sql
```

Manual SQL, not a forward migration — the discipline rule is append-only. If we ever revert, we write a new migration to do the inverse.
