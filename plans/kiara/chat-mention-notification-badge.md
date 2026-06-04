---
owner: ki-dev-piqc
feature: chat-mention-notification-badge
status: active
started: 2026-06-04
target_pr:
---

# Chat: global @-mention notification badge

## Context

Mentions Phase B added a per-channel amber `@` badge to the chat
sidebar. That works once the user is already inside the Chat tab —
but a user on Today / Visits / Reports / anywhere else won't see it.
Add a small notification badge that's visible from any page in the
app so the user knows to come back to chat.

## Design

A new lightweight `UnreadMentionsProvider` mounted high in the App
tree (next to the other context providers, after Auth + Org). It
subscribes once to `chat_mentions` for the current user and tracks a
single integer: `totalUnread`. INSERT events increment;
UPDATE-from-null-to-non-null events decrement.

This subscription duplicates work with `useChatUnread`'s
per-channel mention tracking, but only by one extra realtime
subscription and a trivial counter — the duplication keeps the
provider standalone (no coupling to the chat tab being mounted) and
avoids a bigger refactor. If we later care to dedupe, the per-channel
hook can derive its counts from this provider; for v1, ship the
small duplication.

### Three render surfaces for the count

1. **Navbar dropdown trigger** — small amber dot anchored to the
   user-menu button. No count text, just a presence indicator. This
   is the one the user sees from any page.
2. **Organization entry inside the user-menu dropdown** — `@N` pill
   next to the label so the user knows what to click to clear it.
3. **Chat sub-tab pill inside `OrganizationPage`** — amber dot/count
   on the Chat tab to confirm the right destination once they're in
   the org page.

The per-channel badge already in the chat sidebar (from PR 4b) stays
unchanged. It complements this PR by telling the user WHICH channel
the mention is in once they open Chat.

### Clearing behavior

The total clears as the chat tab's per-channel `markAsRead` flows fire.
Those flows already call `markChatMentionsRead` RPC which writes
`read_at = now()`. The provider's realtime subscription sees the
UPDATE event and decrements. No additional wiring needed.

## Scope (files allowed)

### New

- `src/context/UnreadMentionsContext.tsx` — provider + hook.
- `plans/kiara/chat-mention-notification-badge.md` — this file.

### Modified

- `src/App.tsx` — wrap tree with `<UnreadMentionsProvider>` inside
  `<OrgChatProvider>`.
- `src/components/Navbar.tsx` — render the dot on the user-menu
  trigger, render the pill on the Organization menu entry.
- `src/components/dashboard/organization/OrganizationPage.tsx` —
  render the badge on the Chat sub-tab pill.

### Out of scope

- Browser notifications API — needs permission prompts + service
  worker for background delivery; significant scope.
- Email notifications on mention — Resend infrastructure exists from
  invites; reuse is straightforward but defer to a separate PR.
- A "mentions inbox" view listing every mention across channels with
  jump-to-message links. Useful next layer; deferred.

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [x] context (new UnreadMentionsProvider)
- [x] component (Navbar + OrgPage badge surfaces)
- [ ] test

## Mock data plan

None.

## Approved-by

- `@ish-dev-piqc` — `src/App.tsx` + `src/components/Navbar.tsx` are
  shared chrome (2-reviewer rule). Changes are additive: one new
  provider in the existing nest, badge spans on a button + a menu
  entry.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual, two browsers as two members:
  - User A on `#general` mentions user B (`@B`).
  - User B is on Today (or any non-chat page). Within ~1s, B's
    navbar user-menu trigger shows the amber dot.
  - B opens the user-menu → "Organization" entry shows `@1`.
  - B clicks → lands on the Organization page (last sub-tab); switches
    to Chat → `#general` row in the sidebar shows the amber `@`.
  - B clicks `#general` → both the local sidebar badge AND the global
    badges clear within ~1s (realtime UPDATE fires).
- Self-mention: B mentions themselves in any channel → no badge
  (mentions hook already skips self-author posts on the per-channel
  badge; global counter behaves the same because the trigger inserts
  no row when mentioned_user_id = author_user_id is uninteresting,
  but actually the trigger DOES insert; the badge counter then sees
  the INSERT but the user clears it immediately via the chat tab's
  active-channel mark-as-read. Acceptable; nothing to fix in v1.)
- Logged out: provider returns 0 and renders nothing. Login → fetch +
  subscribe.
