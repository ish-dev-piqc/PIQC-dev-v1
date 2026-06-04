---
owner: ki-dev-piqc
feature: chat-mentions
status: merged
merged: 2026-06-04
started: 2026-06-04
target_pr: #267
---

# Chat @mentions

## Context

Chat surfaces (org-wide #general + per-protocol channels) need a way to
explicitly pull someone's attention. Plain @-text doesn't convey clear
intent and doesn't notify anyone. This brings Slack-style @mentions:
type `@`, pick a member, the mention renders as a styled chip in the
sent message, and (Phase B) the mentioned user gets notified.

## Design

### Phased rollout

**Phase A (this PR)** — composer + rendering:
- Composer popover with member autocomplete when typing `@`
- Sent message body stores mentions as `<@<userId>>` literal tokens
- Rendered messages parse those tokens and replace them with chips
  showing `@FirstName`, with the full name as a tooltip
- Self-mentions render with a distinct background

**Phase B (next PR)** — notifications & scoped picker:
- `chat_mentions` table with `(message_id, message_kind, mentioned_user_id, created_at, read_at)`
- Realtime subscription for `mentioned_user_id = self`
- Sidebar mention indicator on channels with unread mentions (a `@`
  badge in addition to the regular unread count)
- Picker filters to chat-eligible members per channel
  (org members for #general; protocol coord/member + admins for
  protocol channels)

This PR ships Phase A only. Phase B builds on it without changing
Phase A's storage format — same `<@<userId>>` tokens, just with a
sibling notifications table populated alongside the message insert.

### Storage format

Mention tokens are written into the message body verbatim as
`<@<userId>>` (Slack convention, e.g. `<@U12345>` but with our UUIDs).
Pros: no schema change in Phase A; existing `org_messages` /
`protocol_messages` tables hold mentions as plain text; the format is
self-contained and unambiguous to parse.

Cons: the raw text in the database isn't human-readable, but that's
the trade-off for keeping the data model simple. Tools that read the
DB directly (audit, exports) will see token text and can either resolve
on the fly or treat it as opaque.

### Composer flow

User types `@` in the textarea:
1. Detect that the cursor is inside an `@`-word (`@` immediately
   preceded by start-of-text or whitespace, followed by name chars or
   the empty string)
2. Show a popover anchored above the textarea, filtered by the typed
   characters after `@`
3. Keyboard: ↑/↓ to navigate, Enter to pick the highlighted member, Esc
   to dismiss. Click also selects.
4. On pick, the `@<typed>` span in the textarea is replaced with
   `<@<userId>> ` (token + trailing space) so the user can continue
   typing. The picker closes.
5. If the user types Space or moves the caret out of the `@`-word
   without picking, the picker dismisses and the literal `@<typed>`
   stays in the composer as plain text (no mention created).

### Render flow

On each message, the body is split by the regex `<@(<uuid>)>` and each
matched token resolved to a member name via the org-members profile
map (already loaded by ChatTab for author lookups). Output is a mix
of text spans and styled `MentionChip` spans:

- `@FirstName` text in the chip
- Background tint that pops against both bubble colours
- `title="FirstName LastName"` for the full name
- Self-mentions get a slightly stronger background to draw the eye

Unknown user ids (member left the org, was deleted from auth) render
as `@unknown` in muted text.

### Composer placement constraint

The popover is absolute-positioned above the textarea, anchored to the
left edge of the composer container (not to the cursor position).
Anchoring to the cursor would require measuring caret position in
pixels which is fiddly for a plain textarea. Left-edge anchoring is
the same simplification Slack used in its v1 mentions UX.

## Scope (files allowed)

### Modified

- `src/components/dashboard/organization/ChatTab.tsx` — composer logic
  for detecting `@`, showing the picker, inserting the token; render
  helper that parses `<@<uuid>>` and emits chips.

### Out of scope (Phase B candidates)

- `supabase/migrations/**` — no DB change in Phase A. Phase B adds the
  `chat_mentions` table.
- `src/lib/orgs/orgsApi.ts` — no new endpoints needed; mentions are
  embedded in the message body, so the existing `postOrgMessage` /
  `postProtocolMessage` paths carry them.
- `src/hooks/useChatUnread.ts` — Phase B extends this with a
  `mentionCounts` map.
- Per-channel picker scope (Phase B).
- Notifications outside the Chat tab (Phase B+).

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [x] component (ChatTab only)
- [ ] test

## Mock data plan

None.

## Approved-by

Self-only.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Manual:
  - Type `@` in composer → picker appears above textarea
  - Type more characters → list filters by name
  - ↑/↓/Enter pick a member → text replaced with token + trailing space; picker dismisses
  - Esc dismisses without inserting
  - Click outside dismisses without inserting
  - Send the message → recipient sees `@FirstName` chip in the bubble
  - Hover the chip → tooltip shows the full name
  - Mention yourself → chip background is stronger
  - Mention someone no longer in the org → chip reads "@unknown" in muted text
  - Regular text adjacent to a mention renders correctly (no awkward whitespace)
