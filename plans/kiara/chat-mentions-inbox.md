---
owner: ki-dev-piqc
feature: chat-mentions-inbox
status: active
started: 2026-06-04
target_pr:
---

# Chat: mentions inbox

## Context

The navbar badge tells users they've been @-mentioned somewhere; the
sidebar `@` badge inside the chat surface tells them which channel.
But there's no way to see a list of every mention across channels —
the user has to click into each channel one at a time. This PR adds
a "Mentions" inbox: a side panel listing every chat mention for the
current user, newest first, with the message preview, sender,
channel, timestamp, and a jump-to-message action.

Pairs with the navbar notification badge added in
`chat-mention-notification-badge.md`. Now the badge is a clickable
destination, not just a signal.

## Design

### Trigger

A new bell icon button in the navbar, next to the user-menu trigger.
The existing user-menu trigger keeps its amber dot for backward
compatibility (so users who learned to click the avatar still find
it via the Organization entry inside the menu), but the dedicated
bell is the primary path.

The bell shows the same `@N` pill on the right as the Organization
entry. Click → opens the inbox panel. Click again or click outside
→ closes.

### Inbox panel

Slide-in from the right (mirrors `DecisionList`'s side panel pattern).
Header: "Mentions (N unread)" with a close button. Body: a list of
rows, newest mention first, paginated client-side at the most recent
200 rows.

Each row:
- Sender name + small avatar
- Channel label (`#general` or `#<protocol_code>`)
- Message body preview (first ~80 chars, mentions resolved to `@Name`)
- Relative timestamp (`2h ago`, `Yesterday at 3:42 PM`, etc.)
- Unread dot on the left edge if `read_at` is null
- "Open in channel" button → navigates the chat tab to the source
  message

The current row's hover state is a subtle background; click anywhere
on the row also navigates. The panel does NOT mark anything as read on
view — same as Gmail / Slack, the user has to actually open the channel
for `read_at` to flip.

### Cross-component navigation

When the user picks an inbox row, we need to:
1. Switch to the Organization page
2. Set the Chat sub-tab as active
3. Set the channel in localStorage so ChatTab picks it up
4. Stash a "scroll to this message id" hint in localStorage so ChatTab
   highlights + scrolls after mount

`App.tsx` gains `handleNavigateToOrgChat(channelKey, messageId?)`. This
helper writes the channel + pending-highlight keys to localStorage,
sets `organizationInitialTab` to `'chat'`, sets `dashboardTab` to
`'organization'`, and bumps `view` to `'dashboard'`. ChatTab on mount
reads the pending-highlight key, scrolls + highlights, then clears it
so a refresh doesn't keep re-highlighting.

### Data source

New `listMyMentionsWithContext(limit)` API. Returns a flattened view
of chat_mentions joined to the parent message and its channel: each
row carries `body` preview, `channel_kind` ('org'|'protocol'),
`channel_id`, `mentioned_by_user_id`. The hook subscribes to
chat_mentions for the current user (already done in
`UnreadMentionsContext`) and re-fetches the inbox list on changes.

Body preview is the first 200 chars of the message body, with
`<@<uuid>>` tokens resolved server-side to `@Name`. To avoid bloating
the API, the client just strips the wire-format tokens and replaces
them with `@unknown` if the user isn't in the local profile cache;
otherwise resolves via `useOrg`'s member list.

### Out of scope

- Filter UI (by channel, by sender, read/unread) — easy to add later.
- Per-mention reply box. v1 just navigates to the channel.
- Email digest of mentions. Future.
- Mention notification preferences (mute, etc.). Future.

## Scope (files allowed)

### New

- `src/hooks/useMentionsInbox.ts` — fetches + subscribes; returns
  ordered list with channel metadata.
- `src/components/dashboard/organization/chat/MentionsInbox.tsx` —
  the side panel.
- `plans/kiara/chat-mentions-inbox.md` — this file.

### Modified

- `src/lib/orgs/orgsApi.ts` — `listMyMentionsWithContext(limit)`.
- `src/components/Navbar.tsx` — new bell-icon button + `@N` pill +
  click → opens the inbox panel via a new prop.
- `src/App.tsx` — `inboxOpen` state, mounts the inbox panel,
  passes `onOpenMentionsInbox` down to Navbar.
  `handleNavigateToOrgChat(channelKey, messageId?)` helper.
- `src/components/dashboard/organization/ChatTab.tsx` — on mount, read
  the `piq-chat-pending-highlight-v1` localStorage key, call
  `jumpToSourceMessage(messageId)` if present, then clear the key.

### Out of scope

- New context. The inbox panel is mounted at App-tree level and uses
  the existing `UnreadMentionsContext` for the count plus its own
  one-shot list fetch via the hook.
- Storage schema. The inbox is purely a view over `chat_mentions`.

## Architecture layers touched

- [ ] migration / RPC / adapter
- [x] component (Navbar + new panel + ChatTab on-mount jump)
- [x] context (App state for inbox panel; uses existing
       UnreadMentionsContext for badge totals)
- [ ] test

## Mock data plan

None.

## Approved-by

- `@ish-dev-piqc` — `src/App.tsx` + `src/components/Navbar.tsx` are
  shared chrome (2-reviewer rule). Additive: one button + one state
  field + one panel mount.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual, two browsers:
  - User A @-mentions B in `#general`. B (on Today tab) sees the
    navbar bell get an amber dot + `@1` pill within ~1s.
  - B clicks the bell → inbox panel slides in showing the new mention
    at the top: A's name, `#general`, preview "Hey @B can you …",
    `just now`, unread dot.
  - B clicks the row → navigates to Organization → Chat → `#general`,
    scrolls to A's message, briefly highlights it. The unread dot in
    the inbox clears (read_at gets flipped by the existing
    markChatMentionsRead path).
  - B mentions A in `#PP06489`. Symmetric flow.
  - B opens the inbox while logged out → not rendered.
  - Cap at 200 rows works; below 200 just renders the count.
  - Mechanical checks pass.
