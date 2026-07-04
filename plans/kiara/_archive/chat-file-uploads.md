---
owner: ki-dev-piqc
feature: chat-file-uploads
status: merged
merged: 2026-06-04
started: 2026-06-04
target_pr: #275
---

# Chat: file uploads

## Context

Clinical-trial chat conversations constantly want to attach a file — a
PDF excerpt of a protocol amendment, a screenshot of a deviation
notification, an Excel of enrollment numbers, a Word doc of a signed
consent. Right now chat is text-only. This PR adds first-class file
attachments to both `#general` (org) and per-protocol channels.

First feature in the "clinical-trial distinctive" sequence (1 of 3).
The next two are read confirmation on decisions and cross-mode references.

## Design

### Storage layout

A new Supabase Storage bucket `chat-attachments`, private (not public-
readable), 10MB per-file cap configured at the bucket level. Files
written under user-scoped paths:

```
chat-attachments/<uploader_user_id>/<uuid>-<original_filename>
```

Path obfuscation via UUID prefix. Storage RLS gates reads against the
`chat_attachments` table — a file is readable only if the caller can
see the chat message that owns it. Storage INSERT is allowed for any
authenticated user into their own `<uploader_user_id>/...` subpath
(messageless orphans are possible but harmless; a cron job can sweep
later if needed).

### chat_attachments table

```
chat_attachments (
  id                       uuid pk default gen_random_uuid(),
  org_message_id           uuid references org_messages(id)      on delete cascade,
  protocol_message_id      uuid references protocol_messages(id) on delete cascade,
  org_id                   uuid references orgs(id)              on delete cascade,
  protocol_id              uuid references protocols(id)         on delete cascade,
  storage_path             text not null unique,
  mime_type                text not null,
  size_bytes               bigint not null check (size_bytes > 0),
  original_filename        text not null,
  uploaded_by_user_id      uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  -- Channel xor matches chat_mentions / chat_decisions.
  check (
    (org_message_id is not null and protocol_message_id is null
      and org_id is not null and protocol_id is null)
    or
    (org_message_id is null and protocol_message_id is not null
      and org_id is null and protocol_id is not null)
  )
)
```

RLS mirrors message RLS:
- **SELECT** — caller can see the parent message via its channel access
  (org_member for org_id, protocol coord/member or org admin for protocol_id).
- **INSERT** — same access + `uploaded_by_user_id = auth.uid()`.
- **DELETE** — uploader OR org admin OR (for protocol channels) protocol
  coordinator.
- **UPDATE** — none. Attachments are immutable.

ON DELETE CASCADE on the message FKs means deleting a message takes its
attachment rows with it. The Storage objects themselves are NOT cleaned
up by FK cascades; a separate Edge Function or cron can sweep orphans
later. For v1, accept the orphan risk — Storage size is cheap and the
files are still inaccessible without a corresponding chat_attachments
row (Storage RLS denies SELECT).

Index: `(org_message_id)`, `(protocol_message_id)`, both for fast
per-message attachment fetch.

### Realtime

Added to `supabase_realtime` publication. ChatTab's per-channel
attachments subscription mirrors the chat_decisions pattern — listens
to INSERT and DELETE filtered by `org_id` / `protocol_id`.

### Upload flow

1. User drags files into the chat panel OR clicks a paperclip button
   in the composer OR pastes (Cmd+V) a file/image.
2. Each file becomes a "pending attachment" rendered as a chip below
   the textarea: thumbnail (images) or generic file icon (others) +
   filename + size + X-to-remove. Client-side size check rejects
   files over 10 MB with an inline error chip.
3. User clicks Send. The send flow:
   1. Calls `postOrgMessage` / `postProtocolMessage` to insert the
      message and get its id.
   2. For each pending file, uploads to Supabase Storage at
      `chat-attachments/<userId>/<uuid>-<filename>` and inserts a
      `chat_attachments` row tied to the message id.
   3. If any single upload fails, the message is still posted but a
      banner notes which file(s) failed and stays present until the
      next compose. (Alternative would be to roll back the message —
      simpler is to keep the message and surface the failure.)
4. Realtime echo and the local optimistic append both refresh the
   in-bubble attachment list.

### Render flow

Per message:
- Body text first (`<@<uuid>>` tokens still expand to chips as today).
- Below: attachment grid.
  - **Image-mime types** (image/png, image/jpeg, image/gif, image/webp):
    inline thumbnail bounded to 240px max width / 240px max height,
    rounded corners, click opens the full-size image in a lightbox
    modal.
  - **Other types**: a horizontal row — generic file icon + filename
    + size in MB/KB + download button. Click downloads via a signed
    URL.
- Multiple attachments per message lay out as a wrap-grid for images,
  vertical stack for non-images.

### Signed URL strategy

Reads use `createSignedUrl` from the Supabase JS client (60-second
expiry). The client-side download handler calls
`supabase.storage.from('chat-attachments').createSignedUrl(path, 60)`
and either opens the URL (images, PDFs in a new tab) or triggers a
download via a synthetic `<a download>` click.

`createSignedUrl` respects bucket RLS, so the same SELECT policy that
gates message access also gates URL generation. No additional RPC
required.

## Scope (files allowed)

### New

- `supabase/migrations/2026XXXX_chat_attachments.sql` — table, RLS,
  bucket creation, storage policies, realtime publication.
- `src/lib/orgs/chatAttachmentsAdapter.ts` — pure row mapper.
- `src/lib/orgs/__tests__/chatAttachmentsAdapter.test.ts` — sibling test.
- `src/hooks/useChannelAttachments.ts` — per-channel attachment fetch +
  realtime subscription.
- `src/components/dashboard/organization/chat/AttachmentPicker.tsx` —
  composer-side file picker UI (paperclip button + pending list with
  remove + size-cap validation).
- `src/components/dashboard/organization/chat/AttachmentRender.tsx` —
  in-bubble rendering (image grid + file row layout) + simple image
  lightbox.
- `plans/kiara/chat-file-uploads.md` — this file.

### Modified

- `src/types/orgs/index.ts` — `ChatAttachment`, `NewChatAttachmentInput`.
- `src/lib/orgs/orgsApi.ts` — `uploadChatAttachment`,
  `listChannelAttachments`, `deleteChatAttachment`,
  `getAttachmentSignedUrl`.
- `src/components/dashboard/organization/ChatTab.tsx` — wires the
  picker + render into the composer / message bubbles; drag-drop
  handler at the chat panel root; attachment hook + map per message.

### Out of scope (Phase 2 candidates)

- Server-side virus scanning. ClamAV-as-a-service is doable but adds
  infra; defer.
- File-type whitelisting beyond the 10MB size cap. v1 accepts any
  type the user uploads; bad-actor attachment vectors are scoped by
  the channel RLS (only chat members see them).
- Editing / reordering attachments after send. Immutable in v1.
- Orphaned-storage cleanup job. Background sweep can come later.
- Inline preview for PDFs / Office docs. v1 renders as a file row
  with download button; click → opens in new tab via signed URL.
- Mention-style autocomplete from attachment filenames in body.
- Quote-reply with attachment carry-over.

## Architecture layers touched

- [x] migration
- [ ] RPC
- [x] adapter
- [ ] context (uses existing chat contexts; realtime sub is in the hook)
- [x] component
- [x] test (sibling adapter test)

## Mock data plan

None.

## Approved-by

- `@rg-dev-piqc` — new migration in `supabase/migrations/`, plus
  Supabase Storage bucket configuration via SQL.
- `@ish-dev-piqc` — N/A; no shared-chrome changes (Navbar/App
  untouched).

## Verification

- `npx supabase db push --linked` applies cleanly; the bucket appears
  in the Supabase Storage dashboard.
- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `npx vitest run` → adapter test passes
- Mechanical checks:
  - No supabase import in `src/components/**` (storage upload lives
    in API + hook layers, not in components)
  - No `.channel(` / `postgres_changes` in `src/components/**` (sub
    lives in the hook)
  - New API/adapter has sibling tests
  - Plan MD referenced in PR body
- Manual (two browsers as two members):
  - User A drags a PNG into the chat panel → preview chip appears
    below the composer; click X removes it.
  - User A picks a PDF via the paperclip button; preview shows file
    icon + name + KB.
  - User A pastes an image from clipboard → it joins the pending list.
  - Send → message appears with the PNG inline (clickable to lightbox)
    and the PDF as a file row with download button.
  - User B sees the same message + attachments within ~1s (realtime).
  - User B clicks the PDF → downloads (signed URL).
  - File > 10 MB → rejected with inline error before send.
  - Author can delete own attachment via a small X on the rendered
    attachment (hover-only); admin can delete any. Storage object
    becomes orphaned but inaccessible.
  - Viewer on a protocol can't see attachments (RLS).
- RLS:
  - SELECT on chat_attachments + storage.objects both gate via the
    parent message's channel access.
  - INSERT into chat_attachments requires uploaded_by_user_id = self.
