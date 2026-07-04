---
owner: ki-dev-piqc
feature: chat-polish-v2
status: merged
merged: 2026-06-04
started: 2026-06-04
target_pr: #291
---

# Chat polish v2 — edit / soft-delete / reactions

## Context

Three orthogonal polish items on the chat surface that move it closer
to Slack-level fluency without needing thread mechanics. Thread
replies are intentionally deferred to a follow-up PR because they
need a `parent_message_id` schema column, a separate scroll region,
and new mention semantics — too big to bundle here.

## Design

### Schema

Two new nullable columns on **both** `org_messages` and
`protocol_messages`:

- `edited_at TIMESTAMPTZ NULL` — set when the author edits; null
  means "never edited."
- `deleted_at TIMESTAMPTZ NULL` — set when the message is
  soft-deleted; null means "still visible."

Soft delete leaves `body` and attachments intact in the DB. The UI
treats `deleted_at IS NOT NULL` as the signal to render a
"_(this message was deleted)_" placeholder and hide attachments +
reactions. Easier to recover than a hard delete; admins can later
purge if needed.

`UPDATE` policies updated so the author can write to `body`,
`edited_at`, `deleted_at` on their own rows; org admins can write
`deleted_at` on any row in their org.

New table:

```sql
create table public.chat_reactions (
  id                  uuid primary key default gen_random_uuid(),
  org_message_id      uuid references public.org_messages(id)      on delete cascade,
  protocol_message_id uuid references public.protocol_messages(id) on delete cascade,
  org_id              uuid references public.orgs(id)              on delete cascade,
  protocol_id         uuid references public.protocols(id)         on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  emoji               text not null check (length(emoji) between 1 and 16),
  created_at          timestamptz not null default now(),

  constraint chat_reactions_channel_xor check (...),
  unique (org_message_id, user_id, emoji),
  unique (protocol_message_id, user_id, emoji)
);
```

Mirrors the `chat_attachments` xor + denormalized channel-ref
pattern. The uniques mean "I can't react with 👍 twice on the
same message" — clicking 👍 a second time deletes the row.

### TS types

- `OrgMessage` / `ProtocolMessage` gain `edited_at: string | null`
  and `deleted_at: string | null`.
- New `ChatReaction` type mirrors the row.

### Adapter / API

- `orgMessagesAdapter` / `protocolMessagesAdapter` pass new cols
  through. No new adapter files.
- `orgsApi`:
  - `editOrgMessage(id, body)` — RLS-gated to author. Sets
    `edited_at = now()`.
  - `editProtocolMessage(id, body)` — same.
  - `softDeleteOrgMessage(id)` / `softDeleteProtocolMessage(id)`
    — sets `deleted_at = now()`. Author or admin.
  - `listReactionsForMessages(messageIds, channel)` — returns
    `ChatReaction[]` across the page. One query per channel.
  - `addReaction({ messageId, channel, emoji })`.
  - `removeReaction({ messageId, channel, emoji })`.
- New sibling test file `chatReactionsAdapter.test.ts` (pure
  adapter, even though it's small — sibling-test mechanical-check
  applies to API files, but adding one anyway for clarity).

### Context

`OrgChatContext` + `ProtocolChatContext` already realtime-stream
`INSERT`s on the message tables. We extend them to also handle
`UPDATE` events (for edit + soft-delete) — they replace the row in
the cache. New realtime channel for `chat_reactions` keeps the
reactions cache fresh.

### UI

- New `MessageActions` component — hover-revealed icon row
  (`Edit`, `Trash`, `Smile`). Lives next to the existing
  `MessagePromoteButton`. Each icon conditionally renders:
  - Edit: shown when `isSelf && !deletedAt`.
  - Trash: shown when `isSelf || isOrgAdmin`, when `!deletedAt`.
  - Smile: shown when `!deletedAt` (anyone can react).
- New `ReactionPicker` popover — six emojis: 👍 ✅ ❤️ 😬 🙏 📊.
  Click adds the reaction (or removes if already present).
- New `ReactionChips` row — under the bubble. One chip per unique
  emoji on this message, showing count + own-toggle state.
  Click chip → add/remove own reaction.
- Edit mode in ChatTab — when `editingMessageId === m.id`, the
  bubble swaps for an inline `<textarea>` with the existing
  composer styling. Enter saves; Esc cancels.
- Deleted-message rendering — italic `(this message was deleted)`
  in `text-fg-muted`. Attachments and reactions hidden. Decision
  link stays (the decision row already snapshot-ted the source
  body, so the audit trail isn't lost).

## Scope (files allowed)

### New

- `supabase/migrations/20260704000200_chat_polish_v2.sql`
- `src/lib/orgs/chatReactionsAdapter.ts`
- `src/lib/orgs/__tests__/chatReactionsAdapter.test.ts`
- `src/components/dashboard/organization/chat/MessageActions.tsx`
- `src/components/dashboard/organization/chat/ReactionPicker.tsx`
- `src/components/dashboard/organization/chat/ReactionChips.tsx`
- `plans/kiara/chat-polish-v2.md` — this file.

### Modified

- `src/types/orgs/index.ts` — add cols + `ChatReaction` type.
- `src/lib/orgs/orgMessagesAdapter.ts` — pass new cols through.
- `src/lib/orgs/protocolMessagesAdapter.ts` — same.
- `src/lib/orgs/orgsApi.ts` — six new helpers.
- `src/lib/orgs/__tests__/orgsApi.test.ts` — extend smoke surface to
  cover the six new exports.
- `src/context/OrgChatContext.tsx` — handle UPDATE events on
  org_messages + realtime sub on chat_reactions.
- `src/context/ProtocolChatContext.tsx` — same.
- `src/components/dashboard/organization/ChatTab.tsx` — mount the
  new components, edit mode state, reaction handlers.

## Architecture layers touched

- [x] migration
- [x] adapter
- [x] context (realtime sub + UPDATE handling)
- [x] component
- [x] TS type
- [ ] RPC (no new RPCs — direct table writes via RLS)

## Mock data plan

None.

## Approved-by

- `supabase/` — Roger (alters existing tables + adds new one with RLS).

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Sibling tests pass.
- Manual:
  - Edit own message in #general — body changes, "(edited)" shows.
  - Try to edit someone else's — no pencil icon.
  - Soft-delete own — placeholder text, attachments hidden.
  - Admin deletes someone else's — works.
  - React 👍 to a message — chip appears with count 1. Click again — chip removes. Other user reacts 👍 — chip count goes to 1 again for them.
  - Two browsers — realtime: edits + deletes + reactions all show across browsers within ~1s.
  - Deleted message that was a Decision source — the Decision card still shows the snapshot title in the side panel.
