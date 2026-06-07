---
owner: ki-dev-piqc
feature: chat-search
status: merged
merged: 2026-06-07
started: 2026-06-04
target_pr: #305
---

# Chat search — query across all accessible channels

## Context

The chat surface has matured (decisions, mentions, threads,
reactions, attachments) but there's no way to find a past message
without manually scrolling each channel. This PR adds a search
input + results panel that hits both message tables and returns
matches across every channel the user can see — RLS does the
access gating for free.

## Design

### v1 scope

Bare text search. One input, one result list.

Out of scope (v2 candidates):

- Author filter
- Channel filter / restrict-to-current-channel toggle
- Date range
- Tokenized search syntax (`from:karl`, `in:PP06489`)
- Searching inside attachment contents
- Full-text-search (tsvector + GIN) — ILIKE is fine at our scale;
  upgrade later if needed.

### New API — `searchChatMessages`

```ts
searchChatMessages({ query, limit = 50 }):
  Promise<Result<ChatSearchHit[]>>;
```

Where `ChatSearchHit` is the message row plus a denormalized
channel label (`'org'` + `org_id`, or `'protocol'` + `protocol_id`
+ protocol code).

Implementation:

1. Skip if `query.trim().length < 2` (avoids one-letter floods).
2. Build the LIKE pattern `%escaped%`. Escape `%` and `_` per
   PostgreSQL ILIKE rules.
3. Two parallel queries: org_messages + protocol_messages, both
   filtering `body ILIKE pattern AND deleted_at IS NULL` and
   ordering by `created_at DESC LIMIT 50`. RLS already prunes
   channels the caller can't read.
4. Merge client-side, re-sort newest first, cap at `limit`.

### UI — `ChatSearchPanel.tsx`

Slide-in from the right (same shape as the mentions inbox and
thread panel). Header: input + close. Body: list of hits.

Per row:

- Channel pill (e.g. `#general` or `#PP06489`)
- Author + relative timestamp
- Body snippet — truncated with the matched substring highlighted
  inline (`<mark>` wrap around the matched text, case-insensitive).

Click row → calls `navigateToOrgChat(channelKey, messageId)` from
`ChatNavigationContext` — same handler the mentions inbox uses.

### Trigger

Magnifying glass icon in the chat sidebar header (next to the
existing chevron). Click opens the panel; ESC / outside click /
explicit close button dismiss.

## Scope (files allowed)

### New

- `src/lib/orgs/chatSearchAdapter.ts`
- `src/lib/orgs/__tests__/chatSearchAdapter.test.ts`
- `src/components/dashboard/organization/chat/ChatSearchPanel.tsx`
- `plans/kiara/chat-search.md` — this file.

### Modified

- `src/lib/orgs/orgsApi.ts` — new `searchChatMessages` helper.
- `src/components/dashboard/organization/ChatTab.tsx` — sidebar
  trigger + panel mount.

## Architecture layers touched

- [x] adapter (pure — snippet builder + match-highlighter)
- [x] API
- [x] component

## Mock data plan

None.

## Approved-by

Self — touched files are all in domains I own.

## Verification

- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- Sibling tests pass.
- Manual:
  - Search "P-0023" → results from any channel that mentions
    `P-0023`. Click a hit → switches to that channel + highlights
    the message.
  - Search "deviation" → matches in #general and protocol
    channels.
  - Non-admin user — no results from channels they can't read
    (RLS confirms).
  - Single-letter input — no query fires; empty state explains
    "Type at least 2 characters".
  - Soft-deleted messages don't appear in results.
