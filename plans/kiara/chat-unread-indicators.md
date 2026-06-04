---
owner: ki-dev-piqc
feature: chat-unread-indicators
status: active
started: 2026-06-04
target_pr:
---

# Chat: unread channel indicators

## Context

After PR 4a + 4b shipped chat (org-wide #general + per-protocol channels
with a Slack-style sidebar), there's no signal that a non-active channel
has new activity. If you're chatting in #PP06489 and a teammate posts
in #general, you don't know until you click back.

This PR adds unread-count badges on the channel rows in the chat sidebar.

## Design

### Last-viewed tracking — localStorage, not server-side (yet)

Each channel key (`org` or `protocol:{id}`) gets a `piq-chat-lastview-{key}`
entry in localStorage holding the ISO timestamp of when the user last had
that channel active. "Unread" = `count(*) FROM <table> WHERE created_at >
last_viewed`.

localStorage is intentionally chosen over a server-side `chat_channel_views`
table for v1:
- Smaller change set; no migration, no RPC, no RLS.
- Cross-device sync isn't critical at this stage (real-world users live
  on one device at a time for clinical-trial workflows).
- We can promote to server-side state in a follow-up if cross-device
  desync becomes a real complaint.

First-time behaviour: if no localStorage entry exists for a channel, the
hook initializes it to `now()` rather than the epoch. New users start
"all caught up" instead of seeing a four-digit unread badge on their
first chat open.

### Realtime + initial fetch

`useChatUnread` (new custom hook in `src/hooks/`):

- On mount, given the org id and the list of accessible channel keys
  (e.g. `['org', 'protocol:abc', 'protocol:def']`), queries
  `count(*)` for each channel where `created_at > last_viewed`.
- Subscribes to INSERTs on each accessible channel (one supabase
  channel per channel key, filtered by `org_id` / `protocol_id`).
- On insert: increment `counts[key]` UNLESS the message belongs to the
  active channel (then also call `markAsRead(key)` so the badge never
  appears for the surface the user is actively reading) OR the message
  was authored by the current user (don't badge your own posts).

Skipping the active channel's increment requires the hook to know what
the active channel is, so the hook signature accepts `activeChannelKey`
as a parameter. When the active channel changes, the hook also calls
`markAsRead(prevActive)` for cleanliness — though by that point the
active channel always has count 0 from the previous markAsRead calls
on every incoming message.

### markAsRead

`markAsRead(key)` sets `counts[key] = 0` and writes `now()` to
localStorage at `piq-chat-lastview-{key}`. Called by ChatTab whenever
the user switches to a channel (so the count clears immediately) and
on every incoming insert that belongs to the currently-active channel.

### Sidebar rendering

Each channel row in the sidebar's `ChannelRow` gets an optional unread
badge — a small pill with the count, capped at "99+" so very stale
channels don't blow out the layout. The badge is:
- Brand-coloured for the org channel (#general)
- The same as the channel-row's own colour treatment otherwise
- Hidden when count is 0

In the collapsed sidebar, the badge becomes a small filled dot in the
top-right corner of the icon — same signal, smaller footprint.

## Scope (files allowed)

### New

- `src/hooks/useChatUnread.ts` — the hook.
- `plans/kiara/chat-unread-indicators.md` — this file.

### Modified

- `src/components/dashboard/organization/ChatTab.tsx` — wire the hook in,
  render badges on `ChannelRow`, mark the active channel as read on
  switch.

### Out of scope

- Server-side `chat_channel_views` table — deferred.
- Notifications outside the Chat tab (banner, system notif, email) —
  later PR.
- Per-message read receipts / required-read confirmations — separate
  feature (clinical-trial decision capture series).
- @mentions — separate next PR in this session.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (hook + ChatTab)
- [ ] test

## Mock data plan

None.

## Approved-by

Self-only. `src/hooks/` is shared infra but the new file is
chat-specific and Kiara-owned.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual, two browsers:
  - User A on #PP06489. User B posts in #general → A's sidebar shows a
    "1" badge on #general row. Click into #general → badge clears,
    messages render including B's new one.
  - User A on #general. User B posts in #PP06489 → A's sidebar shows
    "1" on #PP06489 → switch to it → badge clears.
  - User A posts in any channel themselves → no badge on their own
    sidebar (self-author skip).
  - Collapsed sidebar: badge becomes a small dot top-right of the icon.
  - Refresh after reading → unread state survives; no spurious badge
    on channels you just caught up on.
  - Fresh login on a brand-new account → all badges start at 0 (no
    "view since epoch" blowout).
