---
owner: ki-dev-piqc
feature: cancel-pending-invite
status: active
started: 2026-05-30
target_pr:
---

# Cancel pending org invite

## Context

After a site administrator creates an org invite via the OrgSettingsDrawer, the invite appears in the "Pending invites" list with a "Copy link" affordance. There's no way to revoke a mis-sent invite (wrong email, wrong role, second thoughts) — the row sits until it expires (30 days) or the recipient redeems it.

Add a "Cancel" button on each pending row that deletes the invite. The existing `org_invites_admin_all` RLS policy from `20260520010000_org_invites_table_and_rpcs.sql` already permits admins to DELETE; no migration or RPC needed.

## Design

- New `revokeOrgInvite(inviteId)` in `orgsApi.ts` — `.from('org_invites').delete().eq('id', inviteId)`. Returns `Result<void>`. Hard delete (audit-bearing data isn't on invite rows; the org_members + protocol_members rows that get created on accept stay regardless).
- "Cancel" button in `OrgSettingsDrawer.tsx` next to "Copy link" on each pending invite row. Uses `XCircle` icon, rose-on-hover styling matching the existing `Remove` button on member rows. Confirms via `window.confirm("Cancel the pending invite to <email>?")`.
- Test surface update in `orgsApi.test.ts` — add `revokeOrgInvite` to the exports check.

## Scope (files allowed)

- `src/lib/orgs/orgsApi.ts` — add `revokeOrgInvite`.
- `src/components/dashboard/orgs/OrgSettingsDrawer.tsx` — add `revokeOrgInvite` import + `XCircle` icon import + handler + button render.
- `src/lib/orgs/__tests__/orgsApi.test.ts` — extend exports check.
- `plans/kiara/cancel-pending-invite.md` — this file.

## Out of scope (files forbidden)

- `supabase/migrations/**` — no DB change. The existing `org_invites_admin_all` RLS policy already permits admins to DELETE; we're using it.
- Anything else in `src/`.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (OrgSettingsDrawer)
- [x] test (orgsApi.test.ts exports check)
- [x] util (orgsApi.ts new function)

## Mock data plan

None.

## Approved-by

No cross-domain edits. All files owned by `@ki-dev-piqc` per CODEOWNERS.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `npx vitest run src/lib/orgs/__tests__/` → all green; orgsApi exports test confirms revokeOrgInvite is exported
- Manual: open OrgSettingsDrawer as a site administrator → create a test invite → "Pending invites" list shows it → click the new "Cancel" button → confirm dialog → row disappears, list refreshes
- Verify in Supabase: the corresponding `org_invites` row is gone
- Try as a non-admin: should fail at the RLS layer (no row deleted; banner shows the error message)
