---
owner: ish-dev-piqc
feature: cross-org-collaboration
status: merged
merged: 2026-05-23
started: 2026-05-18
target_pr: #96
---

# Cross-org collaboration — protocol-level multi-org access

## Context

C1 (PRs #94 + #95) established `orgs` + `org_members` with `protocols.owner_org_id` and admin-only RLS for the owning org. Real-world clinical-trial workflows often need **multiple** orgs touching the same protocol — sponsor commissions the study, CRO runs it, sites deliver visits. C2 adds that capability without breaking the single-org model: every protocol still has one owning org, but can optionally grant **collaborator** access to additional orgs.

This PR is the **schema foundation** (table + auto-populate trigger + RLS rewrite). UI to add/remove collaborator orgs ("Share with org" affordance) is the next PR.

## Scope (files allowed)

- `supabase/migrations/20260520020000_protocol_org_access.sql` (NEW)
- `plans/ishika/cross-org-collaboration.md`

## Out of scope (files forbidden)

- All `src/` files. Pure backend. App code keeps working — the new RLS is a superset of C1's behaviour.
- UI for managing collaborator orgs — separate PR (`feat/cross-org-collaboration-ui`).
- Granular permissions on collaborator access (e.g., read-only vs. write). v1 collaborators get the same read+write site_* access as owning-org members; owning-org admins retain protocol-metadata modification. Permission tiers are a follow-up if customers need it.

## Architecture layers touched

- [x] migration (1 new file)
- [x] RPC (RLS policies + trigger)
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test

No `src/types/<domain>/` impact.

## Mock data plan

None.

## Approved-by

- @rv61 — `supabase/migrations/**`.

## Design

```
protocol_org_access (
  protocol_id  UUID NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'collaborator')) DEFAULT 'collaborator',
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by   UUID REFERENCES auth.users(id),
  PRIMARY KEY (protocol_id, org_id)
)
```

- Every protocol gets exactly one `role='owner'` row (the org listed in `protocols.owner_org_id`). An AFTER-INSERT trigger on `protocols` creates it; a backfill statement creates rows for all existing protocols.
- Additional rows with `role='collaborator'` are added explicitly via admin action (UI PR follow-up).
- RLS on `protocol_org_access`: members of any org with an access row can read; only owning-org admins can write.

RLS on `protocols` + `site_*` is rewritten to consult `protocol_org_access` instead of `owner_org_id` directly. The new check: "is the user a member of any org that has access to this protocol?" Strictly broader than C1's check; backward-compatible for single-org protocols.

## Verification

- [ ] After migration, every existing protocol has exactly one row in `protocol_org_access` with `role='owner'` and `org_id = protocols.owner_org_id`.
- [ ] Inserting a new protocol auto-creates its owner-row via the trigger.
- [ ] User in another org cannot see the protocol — until granted via `INSERT INTO protocol_org_access (..., role='collaborator')` by the owning org's admin.
- [ ] Once granted, the collaborator-org's members see the protocol + can read/write its site_* rows.
- [ ] Revoking access (DELETE from `protocol_org_access`) instantly removes visibility for the collaborator org.
