---
owner: ki-dev-piqc
feature: chat-overlay-and-mentions-fold-in
status: merged
merged: 2026-06-12
started: 2026-06-04
target_pr: #323
---

# Chat overlay + mentions fold-in (PR 4 of 6)

## Context

PR 1 added the LeftRail Chat icon as a no-op stub. PR 4 wires it
to a slide-in chat overlay that lets users send messages from any
mode without leaving their current work. The Navbar mentions-inbox
bell collapses into the same overlay (Mentions becomes a filter
inside the overlay rather than its own panel) — the standalone
`MentionsInbox.tsx` component goes away.

## Design

### Overlay surface

`ChatOverlayPanel.tsx` — 320px-wide slide-in from the right edge.
Outside-click and ESC close. Channel pills row across the top
(Mentions · #general · #{protocols user can access}), message
list filling the middle, composer at the bottom, "Open full chat
in workspace" footer link that routes to the hub's Chat tab for
heavy work (threads, decisions, reactions).

Light surface — no decisions / reactions / threads in the overlay
itself (those live in the hub's full Chat tab). Composer is
text-only — no attachments, no `@` autocomplete in v1.

### State + persistence

App-level state, mounted in `App.tsx`:

- `chatOverlayOpen: boolean`
- `chatOverlayInitial: { filter?: 'mentions'; channelKey?: string }`

Last-active channel persisted in localStorage as
`piq-chat-overlay-channel-v1`. On open with no initial filter:
restore last channel. On open with `filter='mentions'`: force
Mentions view (regardless of last channel).

### Rail Chat icon behavior

- Click → toggle the overlay.
- When `dashboardTab === 'organization'` AND the hub's inner tab
  is `'chat'`, the rail icon dims (35% opacity) and clicks are
  no-ops. Detection via localStorage read of `piq-org-tab-v1`.
- Coral unread dot when the user has unread mentions (per the
  existing `UnreadMentionsContext`).

### Bell behavior

Navbar bell currently opens the standalone `MentionsInbox`. After
this PR, it opens the chat overlay with `filter='mentions'`. The
`onOpenMentionsInbox` prop is renamed `onOpenChatOverlayMentions`.

### Mentions filter view

Inside the overlay, the Mentions pill switches the body from
"channel messages" to a list of the user's own @-mentions across
channels (uses the existing `listMyMentionsWithContext` API). Each
row clickable → switches the overlay to that mention's channel
(scrolling to the exact message lands in a polish follow-up).

### Deletions

- `src/components/dashboard/organization/chat/MentionsInbox.tsx`
  — folded into the overlay's Mentions filter. Removed.
- `src/hooks/useMentionsInbox.ts` — was MentionsInbox's
  data loader. The overlay calls `listMyMentionsWithContext`
  directly; the hook's realtime sub is replaced by an on-open
  refetch. No need to keep.

App.tsx and Navbar references to the deleted component / hook
get cleaned up at the same time.

## Scope (files allowed)

### New

- `src/components/dashboard/chat-overlay/ChatOverlayPanel.tsx`
- `plans/kiara/chat-overlay-and-mentions-fold-in.md` — this file.

### Modified

- `src/App.tsx` — overlay state, rail's onChatToggle, bell wiring.
- `src/components/Navbar.tsx` — rename
  `onOpenMentionsInbox` prop → `onOpenChatOverlayMentions`.
- `src/components/dashboard/LeftRail.tsx` — accept `onChatToggle`
  prop, wire Chat icon click + unread dot + dim-when-in-hub-chat.

### Deleted

- `src/components/dashboard/organization/chat/MentionsInbox.tsx`
- `src/hooks/useMentionsInbox.ts`

## Architecture layers touched

- [x] component

## Mock data plan

None.

## Approved-by

Self.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - In any mode, click Chat in the rail → overlay slides in from
    right. Hit ESC → it closes.
  - Click Chat again → overlay opens on the same channel it was
    last on.
  - Click the bell (with unread mentions) → overlay opens
    scrolled to Mentions filter.
  - Type + send → message posts to the active channel.
  - Mentions filter shows hydrated rows; clicking one switches
    to that channel.
  - Visit the hub's Chat tab → rail Chat icon dims, clicks
    no-op. Leave the Chat tab → rail icon active again.
  - Hard refresh → overlay starts closed; last channel
    remembered when opened.
