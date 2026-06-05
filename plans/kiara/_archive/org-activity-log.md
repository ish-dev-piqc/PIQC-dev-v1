---
owner: ki-dev-piqc
feature: org-activity-log
status: merged
merged: 2026-06-05
started: 2026-06-04
target_pr: #287
---

# Organization page: Activity log tab

## Context

Currently there's no audit trail of org membership / role / invite
activity. If Karl gets removed from an org or someone's role gets
elevated, there's no record of who did it or when. This PR adds an
append-only event log with a new `Activity` sub-tab on
`OrganizationPage` (alongside `Members`, `Team`, `Chat`, `Manage`).

## Design

### Schema — `org_events` table

```sql
create table public.org_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  event_type      text not null,           -- see "Event types" below
  actor_user_id   uuid references auth.users(id) on delete set null,
  target_user_id  uuid references auth.users(id) on delete set null,
  target_protocol_id uuid references public.protocols(id) on delete set null,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index on public.org_events (org_id, created_at desc);
```

### Event types (v1)

| event_type                | actor          | target              | payload notes |
|---------------------------|----------------|---------------------|---------------|
| `org_member_added`        | who invited    | new member          | `{ role }` |
| `org_member_removed`      | who removed    | the removed member  | `{ prev_role }` |
| `org_member_role_changed` | who changed it | the affected member | `{ from, to }` |
| `protocol_member_added`   | who added      | the affected member | `{ protocol_id, role }` |
| `protocol_member_removed` | who removed    | the affected member | `{ protocol_id, prev_role }` |
| `protocol_member_role_changed` | who      | affected member     | `{ protocol_id, from, to }` |
| `invite_created`          | who invited    | (null — by email)   | `{ invite_id, email, role }` |
| `invite_accepted`         | the new member | the new member      | `{ invite_id }` |
| `invite_cancelled`        | who cancelled  | (null)              | `{ invite_id, email }` |
| `access_request_approved` | the approver   | the requester       | `{ request_id, protocol_id, role }` |

### Recording — Postgres triggers, not client code

Triggers fire on the canonical tables (`org_members`,
`protocol_members`, `org_invites`, `org_member_protocol_access`,
`protocol_access_requests`). `auth.uid()` resolves the actor
automatically — works whether the call came from a direct table
write or an RPC running as SECURITY DEFINER (since the wrapped
RPCs set `auth.uid()` from the caller via JWT). Can't be bypassed
from the client.

For invite-accept and access-request-approve, the trigger lives on
the underlying row insert (e.g. new `org_members` row from
`accept_org_invite`) and reads context out of the JSONB columns we
add to the trigger (or via separate dedicated INSERT in the RPC).

### RLS

- `SELECT`: visible only when current user is in
  `current_user_admin_org_ids()` for `org_id`.
- `INSERT / UPDATE / DELETE`: no policies — only triggers (running
  with definer privilege) can write.

### TS types

`src/types/orgs/index.ts` gets an `OrgEvent` interface mirroring
the row plus a resolved `event_type` union.

### Adapter + API

- `src/lib/orgs/orgEventsAdapter.ts` — pure mapper from DB row to
  domain `OrgEvent`. Includes a `describe(event)` helper that
  renders a sentence like "Kiara promoted Karl from admin to owner"
  given the row + a member-name lookup map. **Pure** — no supabase
  imports.
- `src/lib/orgs/orgEventsApi.ts` — `listOrgEvents(orgId, { limit,
  before })` returns `Result<OrgEvent[]>`. Paginated by `created_at`
  cursor.

### Context — `OrgEventsContext`? or fetch-on-mount in the tab?

For v1: fetch-on-mount in `ActivityTab`. Events are slow-moving
and visited rarely; no need for a global cache or realtime sub.
Manual refresh button.

### UI — `ActivityTab.tsx`

- Sits at `src/components/dashboard/organization/ActivityTab.tsx`
- Layout: header with refresh button + filter chips (one chip per
  event-type group: "Members", "Roles", "Invites", "Access"),
  then a chronological feed. Each row:

  ```
  [avatar] Kiara promoted Karl from admin to owner
            on PP06489 · 2h ago
  ```

- Empty state: "No activity yet."
- 50 events per page; "Load more" appends.
- Owner/admin gating: tab is only rendered for users in
  `currentUserAdminOrgIds`; OrganizationPage hides the trigger for
  others.

## Scope (files allowed)

### New

- `supabase/migrations/20260604000000_org_events_table_and_triggers.sql`
- `src/lib/orgs/orgEventsAdapter.ts`
- `src/lib/orgs/orgEventsApi.ts`
- `src/components/dashboard/organization/ActivityTab.tsx`
- `plans/kiara/org-activity-log.md` — this file.

### Modified

- `src/types/orgs/index.ts` — add `OrgEvent` + `OrgEventType` union.
- `src/components/dashboard/organization/OrganizationPage.tsx` —
  register `activity` sub-tab; gate by admin/owner role.

## Out of scope

Realtime updates. Backfill (log starts at migration time). Export
to CSV. Per-member activity filter (just the chips for v1).
Notifications/digests of activity events.

## Architecture layers touched

- [x] migration
- [ ] RPC (triggers, not RPCs)
- [x] adapter (pure)
- [x] component
- [x] TS type
- [ ] context (deliberately not added — fetch-on-mount is fine)
- [ ] test

## Mock data plan

None.

## Approved-by

- `supabase/` — Roger (new migration touches multiple tables via
  triggers).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors.
- `piqc-review` mechanical checks: no supabase imports in
  components, adapter pure, no `: any` in `src/lib`.
- Manual:
  - Owner A invites B → event "A invited B as member".
  - B accepts → event "B joined".
  - A promotes B to admin → "A promoted B from member to admin".
  - A removes B → "A removed B".
  - Non-admin C never sees the Activity tab.
  - SQL spot check: every row in `org_events` has a non-null
    `actor_user_id` and a sensible `payload`.
