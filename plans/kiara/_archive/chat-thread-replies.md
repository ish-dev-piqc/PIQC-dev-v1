---
owner: ki-dev-piqc
feature: chat-thread-replies
status: merged
merged: 2026-06-06
started: 2026-06-04
target_pr: #301
---

# Chat thread replies

## Context

Chat polish v2 deliberately deferred threads because of their
heavier surface area: new schema column on both message tables,
new UI panel, new mention semantics decision. This PR ships them.

## Design

### Schema

Add a nullable self-FK to each message table:

```sql
alter table org_messages
  add column parent_message_id uuid references org_messages(id) on delete cascade;
alter table protocol_messages
  add column parent_message_id uuid references protocol_messages(id) on delete cascade;

create index org_messages_parent_idx
  on org_messages(parent_message_id) where parent_message_id is not null;
create index protocol_messages_parent_idx
  on protocol_messages(parent_message_id) where parent_message_id is not null;
```

A reply is a regular message row with `parent_message_id` set. The
main channel list filters `parent_message_id IS NULL` so threads
don't clutter the timeline. Cascade-delete from the parent wipes
the whole thread when the parent is hard-deleted.

Existing surfaces continue to work unchanged:

- **Mentions** — `chat_mentions` trigger fires on any message
  insert including replies; @ in a thread still notifies.
- **Attachments** — `chat_attachments` references message_id, so
  thread replies can carry files.
- **Reactions** — `chat_reactions` references message_id, so
  thread replies can be reacted to.
- **Decisions** — `chat_decisions.source_*_message_id` can point
  to a thread reply just like any message.
- **Soft delete + edit** — same UPDATE policies cover thread
  replies; deleted replies render the same "(this message was
  deleted)" placeholder.

No new mention semantics in v1 — `@user` in a reply pings them
the same way it would in the main channel. "Subscribed to thread"
notifications are out of scope.

### TS types

Add `parent_message_id: string | null` to `OrgMessage` and
`ProtocolMessage`.

### Adapter

Pass `parent_message_id` through; optional on the row type so
legacy selects don't blow up.

### API

- `replyToOrgMessage(parentMessageId, body)` —
  `Result<OrgMessage>`. Inserts a new row with `org_id` resolved
  from the parent, `parent_message_id = parentMessageId`, body
  trimmed + validated.
- `replyToProtocolMessage(parentMessageId, body)` — same pattern.
- `listOrgMessages` / `listProtocolMessages` unchanged in
  signature; they now return both top-level + reply rows. ChatTab
  filters client-side. Future v2 could split into two queries if
  the cache gets uncomfortably large.

### Context

`OrgChatContext` / `ProtocolChatContext` keep the entire message
list (top-level + replies). The existing realtime INSERT handler
already routes new rows in.

### UI

- **MessageActions** — adds a `Reply` icon (MessageSquare from
  lucide) as the first icon in the hover row. Available on every
  non-deleted message that isn't itself a reply (no nested threads
  in v1).
- **Reply-count chip** — under each top-level message that has
  replies, render a small chip "↳ N replies · last reply Xh ago".
  Click opens the thread panel.
- **ChatThreadPanel** — right-side slide-in panel (matches the
  decisions / mentions inbox pattern). Header shows "Thread", body
  shows the parent message (read-only-ish, same bubble styling) +
  divider + replies in chronological order + composer at the
  bottom. Closes on ESC / outside click / explicit close button.

- **ChatTab integration** — new state `activeThreadParentId:
  string | null`. Set by MessageActions Reply click or chip click.
  Cleared by panel close.

### Reply-count derivation

Computed client-side per render from the full messages list:
`Map<parentId, { count, lastAt }>`. Cheap at typical channel sizes.

## Scope (files allowed)

### New

- `supabase/migrations/20260704000300_chat_thread_replies.sql`
- `src/components/dashboard/organization/chat/ChatThreadPanel.tsx`
- `src/components/dashboard/organization/chat/ThreadReplyChip.tsx`
- `plans/kiara/chat-thread-replies.md` — this file.

### Modified

- `src/types/orgs/index.ts`
- `src/lib/orgs/orgMessagesAdapter.ts`
- `src/lib/orgs/protocolMessagesAdapter.ts`
- `src/lib/orgs/orgsApi.ts`
- `src/lib/orgs/__tests__/orgsApi.test.ts` — extend smoke surface.
- `src/components/dashboard/organization/chat/MessageActions.tsx`
- `src/components/dashboard/organization/ChatTab.tsx`

## Architecture layers touched

- [x] migration
- [x] adapter
- [x] API
- [x] component
- [x] TS type
- [ ] context (no changes — existing realtime handles it)

## Mock data plan

None.

## Approved-by

- `supabase/` — Roger (alters both message tables).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Reply to a message in #general → thread panel opens with parent
    + the new reply. Parent in main view shows "↳ 1 reply".
  - Two browsers — A replies, B sees the thread chip appear within
    ~1s via the existing realtime sub.
  - @mention in a reply pings the mentioned user (existing chat
    mentions trigger).
  - Attach a file to a thread reply → renders inline.
  - Soft-delete a thread reply → "(this message was deleted)"
    in the thread panel.
  - Soft-delete the parent → parent shows placeholder; thread chip
    still works; thread panel opens and shows replies.
  - Hard-delete the parent (DB) → cascade wipes replies.
