---
owner: ki-dev-piqc
feature: chat-storage-orphan-cleanup
status: merged
merged: 2026-06-04
started: 2026-06-04
target_pr: #289
---

# Chat: orphan Storage cleanup

## Context

`chat_attachments` rows can disappear (cascade DELETE from a parent
message, or post failures between Storage put + DB insert)
without the corresponding file in the `chat-attachments` Storage
bucket being removed. Over time these orphans cost real money.

This PR adds an admin-triggered sweep that:
1. Counts orphans (files in `storage.objects` for bucket
   `chat-attachments` whose `name` is not referenced by any
   `chat_attachments.storage_path`).
2. On a second click — actually deletes them.

No cron, no scheduled jobs. v1 is a manual button.

## Design

### Two RPCs

- `count_orphan_chat_attachments() → integer` — pure count, used
  for the "Find orphans" preview step. Returns 0 when bucket is
  clean.
- `delete_orphan_chat_attachments() → integer` — actually performs
  the DELETE on `storage.objects`. Returns the row count. Supabase
  Storage uses `storage.objects` as source of truth; deleting the
  row removes the underlying file.

Both are SECURITY DEFINER, both check that `auth.uid()` belongs to
some org as admin (i.e. is a member of `org_members` with
`role='admin'` for any org).

### Adapter / API

`src/lib/orgs/chatAttachmentsCleanupApi.ts` exposes:

```ts
export function countOrphanChatAttachments(): Promise<Result<number>>;
export function deleteOrphanChatAttachments(): Promise<Result<number>>;
```

No adapter — both RPCs return a scalar.

### UI — ManageTab section

New section near the bottom of `ManageTab.tsx`:

> **Storage maintenance**
> Orphaned chat attachments — files in Storage with no matching
> message. Safe to delete.
> [ Find orphans ]

After clicking Find orphans:

> ### Found 12 orphan files. Delete all? This can't be undone.
> [ Cancel ] [ Delete 12 files ]

After Delete: green confirmation banner with count + Find orphans
button resets. Errors surface in a red inline band.

## Scope (files allowed)

### New

- `supabase/migrations/20260704000100_chat_attachments_orphan_cleanup_rpcs.sql`
- `src/lib/orgs/chatAttachmentsCleanupApi.ts`
- `src/lib/orgs/__tests__/chatAttachmentsCleanupApi.test.ts`
- `plans/kiara/chat-storage-orphan-cleanup.md` — this file.

### Modified

- `src/components/dashboard/organization/ManageTab.tsx` — new
  Storage Maintenance section.

## Architecture layers touched

- [x] migration
- [x] RPC
- [x] component
- [ ] adapter / context

## Mock data plan

None.

## Approved-by

- `supabase/` — Roger (RPC touches `storage.objects`).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors.
- New sibling tests pass.
- Manual:
  - As admin: Find orphans on a clean bucket → "Found 0 orphan
    files."
  - Manually upload a file via the Supabase dashboard to the
    `chat-attachments` bucket → Find orphans shows 1 → Delete →
    bucket is clean.
  - As non-admin: RPC call returns RLS error.
