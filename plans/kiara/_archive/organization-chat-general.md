---
owner: ki-dev-piqc
feature: organization-chat-general
status: merged
merged: 2026-06-02
started: 2026-06-01
target_pr: #233
---

# PR 4a: Org-wide general chat channel

## Context

The Organization page sequence (organization-page.md → polish → manage-tab →
unified-team) lands the page itself. PR 4a is the first chat surface — a
single org-wide channel ("#general") that every org member can see and
post in. PR 4b will add per-protocol channels auto-synced from
`protocol_members`.

This PR establishes the chat primitives that PR 4b reuses: the messages
table shape, the realtime subscription pattern in a dedicated context,
the composer + list components.

## Design

### Single channel per org

One row per message in `org_messages`, FK'd to `orgs(id)`. There's no
channel concept yet — that comes in PR 4b when per-protocol channels need
to coexist with this org-wide one. For now: one org, one feed.

### Schema

```
org_messages (
  id              uuid pk default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  author_user_id  uuid references auth.users(id) on delete set null,
  body            text not null check (length(body) > 0 and length(body) <= 10000),
  created_at      timestamptz not null default now()
)
```

`author_user_id` is nullable + ON DELETE SET NULL so removing a user from
the auth system doesn't take their message history with them — the UI
renders "deleted user" for null authors. `body` length-capped at 10K
chars to keep RLS predicate cheap and prevent pathological payloads.

Index on `(org_id, created_at DESC)` so the listing query (most recent
N for a given org) hits an index.

### RLS

- **SELECT** — any `org_members` row for `org_id` allows reads.
- **INSERT** — caller is in `org_members` AND `author_user_id = auth.uid()`.
  Self-impersonation is blocked at the policy layer.
- **DELETE** — author can delete their own; org admins can delete any in
  their org. Useful for the inevitable accidental post and basic moderation.
- **UPDATE** — none. Messages are immutable in v1. (Edit-with-history
  is a v2 concern.)

### Realtime

`org_messages` is added to the `supabase_realtime` publication so clients
can subscribe to INSERTs. The subscription lives in a new
`src/context/OrgChatContext.tsx` (mode-isolation/architecture rule:
realtime in context, not in components). The context exposes `messages`,
`loading`, `error`, and a `postMessage(body)` action.

Channel name: `org_messages:<orgId>`. Filter: `org_id=eq.<orgId>` so
cross-org realtime traffic isn't even shipped down. The subscription
re-subscribes whenever `activeOrg.id` changes; teardown via
`removeChannel` on unmount or org change.

Optimistic append in `postMessage` (push the freshly-inserted row into
state immediately so the user sees their message without waiting for the
realtime echo). The realtime handler dedups by `id` to avoid double-
appending.

### UI

A new `'chat'` sub-tab on `OrganizationPage`, available to all org
members (no admin gate). Three pieces:

1. **Header** — channel label "#general" + member count of the org.
2. **Message list** — scrollable; messages in chronological order
   (oldest at top, newest at bottom). Each message: author name +
   timestamp + body. Self-authored messages are right-aligned with a
   distinct bubble color; everyone else's are left-aligned. Auto-
   scrolls to the bottom on new messages if the user is already near
   the bottom; otherwise stays put so reading older history isn't
   yanked away. Empty state: "No messages yet. Be the first to say
   something."
3. **Composer** — bottom of the tab. Textarea + Send button. **Enter**
   sends; **Shift+Enter** inserts a newline. Disabled while sending or
   when the body is empty/whitespace-only. Resets on successful send.

Author display name is looked up from `org_members_with_profile`
joined client-side by `user_id`. Fetched once on tab mount.

Timestamps render as relative ("2m ago", "1h ago", "Yesterday at 3:42 PM")
with the absolute time as a `title=` tooltip for hover.

### Sub-tab order on OrganizationPage

`Members → Team → Chat → Manage` (Manage stays last; admin-only).

## Scope (files allowed)

### New

- `supabase/migrations/2026XXXX_org_messages.sql` — schema + RLS + realtime publication.
- `src/lib/orgs/orgMessagesAdapter.ts` — pure mapper from DB row to `OrgMessage`.
- `src/lib/orgs/__tests__/orgMessagesAdapter.test.ts` — required by the "new API/adapter files need tests" mechanical check.
- `src/context/OrgChatContext.tsx` — realtime subscription + state + `postMessage`.
- `src/components/dashboard/organization/ChatTab.tsx` — UI (list + composer).
- `plans/kiara/organization-chat-general.md` — this file.

### Modified

- `src/types/orgs/index.ts` — add `OrgMessage`, `NewOrgMessageInput`.
- `src/lib/orgs/orgsApi.ts` — add `listOrgMessages`, `postOrgMessage`.
- `src/App.tsx` — wrap children with `<OrgChatProvider>` inside `<OrgProvider>`.
- `src/components/dashboard/organization/OrganizationPage.tsx` — add `'chat'` to `OrgTab` union; tab pill between Team and Manage; render `<ChatTab />` when active.

### Out of scope (forbidden)

- Per-protocol channels — PR 4b.
- Threads, reactions, DMs, file uploads, mentions, search — future PRs.
- Edit/update messages — v1 immutable.
- Pagination beyond the most-recent-100 — v1 plain scroll, no virtualization. If lists get long enough to matter, add cursor pagination in a follow-up.

## Architecture layers touched

- [x] migration
- [ ] RPC
- [x] adapter
- [x] context
- [x] component
- [x] test (sibling test for the new adapter)

## Mock data plan

None. Realtime path uses the real `supabase_realtime` publication; demo
mode (if active) just won't render any chat UI because `activeOrg` is
null in demo.

## Approved-by

- `@rg-dev-piqc` — `supabase/migrations/**` is in Roger's domain per CODEOWNERS.
- `@ish-dev-piqc` — `src/App.tsx` (provider wiring) is shared chrome (2-reviewer rule).

## Verification

- `npx supabase db push --linked` applies the migration cleanly.
- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors.
- `npx vitest run` passes; the new adapter test runs.
- Manual:
  - Open two browsers, each as a different org member.
  - User A posts a message → it appears in User A's window immediately
    (optimistic) and in User B's window within a second or two (realtime).
  - User A is right-aligned in their own window; User B's message is
    left-aligned in User A's window (and vice versa).
  - Enter sends; Shift+Enter inserts a newline.
  - Send button disabled when the textarea is empty.
  - 10000-char limit enforced — typing past it gets truncated or rejected
    with an error banner.
  - Non-admin sees the Chat tab pill alongside Members + Team (Manage still admin-only).
  - Empty state when the org has no messages yet.
  - Author display: own name on the right; coworker's name on the left.
    Deleted-author messages show "Deleted user".
  - Auto-scroll: at the bottom → new messages scroll into view; scrolled
    up reading history → new messages append but don't yank the viewport.

## Follow-ups (out of scope)

- PR 4b: per-protocol channels with `protocol_members`-trigger auto-sync.
- PR 4c+: read receipts, file uploads, decision capture, mentions, etc.
  See plans/kiara/_archive/protocol-collaboration.md for the original
  per-protocol feature list those PRs will pull from.
