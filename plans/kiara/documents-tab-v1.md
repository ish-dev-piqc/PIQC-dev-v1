---
owner: ki-dev-piqc
feature: documents-tab-v1
status: active
started: 2026-06-04
target_pr:
---

# Documents tab v1 (PR 5 of 6)

## Context

PR 2 added a Documents tab stub to the workspace hub. PR 5 turns
it into a real surface: protocol-scoped document library that
unions three sources — Reducto-ingested protocol PDFs, manually
uploaded files, and chat attachments — under one list. Pinned
chat attachments float to a top board for easy access.

## Design

### Schema

**New table `protocol_documents`** — manually uploaded files. XOR
scope (protocol-level OR org-level, never both):

```sql
create table public.protocol_documents (
  id                   uuid primary key default gen_random_uuid(),
  protocol_id          uuid references public.protocols(id) on delete cascade,
  org_id               uuid references public.orgs(id) on delete cascade,
  storage_path         text not null unique,
  mime_type            text not null,
  size_bytes           bigint not null check (size_bytes > 0),
  original_filename    text not null,
  uploaded_by_user_id  uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint protocol_documents_scope_xor check (
    (protocol_id is not null and org_id is null)
    or (protocol_id is null and org_id is not null)
  )
);
```

RLS:

- **SELECT** — protocol members (via `user_can_access_protocol`)
  or org members (via `current_user_org_ids`).
- **INSERT** — anyone with SELECT access. The brainstorm allowed
  "anyone can upload" so different roles can attach what they
  need; admin/coordinator gating only on delete.
- **DELETE** — org admins (via `current_user_admin_org_ids`) or
  protocol coordinators
  (via `current_user_protocol_coordinator_ids`).
- No UPDATE policies — uploads are immutable.

**ALTER `chat_attachments`** — add `pinned_at TIMESTAMPTZ`. NULL
means not pinned. Anyone with SELECT on a chat_attachment can
toggle the pin (same channel-access gating).

### Storage bucket

New private bucket `protocol-documents`, 25 MB cap. Storage RLS:

- SELECT / INSERT / DELETE gated against the matching
  `protocol_documents` row's RLS via a path-naming convention:
  `<protocolId-or-org-prefix>/<uuid>-<filename>`. Direct Storage
  client SELECT is unauthorized; clients always fetch through a
  signed URL we mint via an existing API helper pattern.

For v1 we mirror the chat-attachments bucket's RLS approach: a
single policy that allows authenticated reads when the user has
SELECT on the parent row (looked up via `storage_path =
storage.objects.name`).

### TS types

New `ProtocolDocument` interface mirroring the row.
`ChatAttachment` gets an optional `pinned_at: string | null`.

### Adapters + API

New `protocolDocumentsAdapter.ts` — row mapper + small helpers
(e.g. format human size). Sibling test.

`orgsApi.ts` additions:

- `listProtocolDocuments({ protocolId?, orgId? })` — direct
  query against `protocol_documents`.
- `listReductoDocumentsForProtocol(protocolId)` — query against
  the existing `documents` table for the read-only "Protocol
  doc" rows.
- `uploadProtocolDocument({ file, protocolId?, orgId? })` —
  Storage upload + DB insert, mirroring `uploadChatAttachment`'s
  cleanup-on-failure pattern.
- `deleteProtocolDocument(doc)` — Storage delete + DB delete;
  admin/coordinator only via RLS.
- `pinChatAttachment(id)` / `unpinChatAttachment(id)` — toggle
  pinned_at.

### UI

`HubDocumentsTab.tsx` rewrite (replaces the stub):

- Toolbar: protocol selector + scope filter pills (This
  protocol / All my docs / Org-level) + Upload button.
- Pinned board: thumbnail cards row for `pinned_at IS NOT NULL`
  chat attachments. Hidden when no pins.
- All-docs list: source-pill rows (Protocol doc · Uploaded ·
  From chat). Each row: type-colored icon, name, uploader+date,
  source pill, size, action menu (Download · Pin/Unpin for
  chat attachments · Delete for admins of own uploads).
- Reducto-ingested rows show a lock icon + disabled action
  menu — readonly.

## Scope (files allowed)

### New

- `supabase/migrations/20260704000700_protocol_documents.sql`
- `src/lib/orgs/protocolDocumentsAdapter.ts`
- `src/lib/orgs/__tests__/protocolDocumentsAdapter.test.ts`
- `plans/kiara/documents-tab-v1.md` — this file.

### Modified

- `src/types/orgs/index.ts` — `ProtocolDocument` type;
  `ChatAttachment.pinned_at`.
- `src/lib/orgs/chatAttachmentsAdapter.ts` — pass `pinned_at`
  through.
- `src/lib/orgs/orgsApi.ts` — the five new helpers above.
- `src/components/dashboard/organization/HubDocumentsTab.tsx` —
  full rewrite.

## Architecture layers touched

- [x] migration
- [x] adapter (pure)
- [x] API
- [x] component
- [x] TS type

## Mock data plan

None.

## Approved-by

- `supabase/` — Roger (new table + new bucket + RLS + storage
  policies + ALTER chat_attachments).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Sibling tests pass.
- Manual:
  - Workspace → Documents tab. Protocol selector shows the
    user's protocols. "This protocol" is the default scope.
  - Reducto-ingested PDF appears with the purple "Protocol doc"
    pill, a lock icon, and disabled action menu.
  - Click Upload → file picker → select a PDF → row appears in
    the list with teal "Uploaded" pill, current user as
    uploader, current timestamp.
  - Pin a chat attachment → row appears in the Pinned board on
    top; unpin → returns to the chronological list only.
  - Delete an uploaded doc (admin/coordinator) → row disappears
    + Storage object gone.
  - Non-admin trying to delete an uploaded doc → RLS denies.
  - Switch scope to "Org-level" → list rescopes to docs without
    a protocol_id.
