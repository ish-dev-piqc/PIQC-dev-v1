---
owner: ki-dev-piqc
feature: organization-chat-per-protocol
status: merged
merged: 2026-06-04
started: 2026-06-03
target_pr: #263
---

# PR 4b: Per-protocol chat channels

## Context

PR 4a landed the org-wide `#general` channel. PR 4b adds per-protocol
channels: one chat surface per protocol, gated by `protocol_members`
role with coordinator/member only (viewers excluded — they're consumers,
not collaborators, per Kiara's direction).

The Chat tab grows a Slack-style left sidebar listing `#general` at the
top and the user's protocol channels below. Sidebar is collapsible
(wide ↔ icon-only) and the state persists across refreshes.

## Design

### Schema

```
protocol_messages (
  id              uuid pk default gen_random_uuid(),
  protocol_id     uuid not null references protocols(id) on delete cascade,
  author_user_id  uuid references auth.users(id) on delete set null,
  body            text not null check (length(body) > 0 and length(body) <= 10000),
  created_at      timestamptz not null default now()
)
```

Index on `(protocol_id, created_at DESC)` for the listing query. Added
to the `supabase_realtime` publication so clients can subscribe to
INSERTs and DELETEs.

### RLS — no separate channel_members table

The original plan mentioned a trigger that maintains a `channel_members`
table mirrored from `protocol_members`. Cutting that — channel
membership *is* protocol membership (with the role filter), so a
trigger that copies one to the other adds maintenance without benefit.
All access checks happen directly on `protocol_members` in the
`protocol_messages` policies.

```sql
-- SELECT: protocol coordinator/member or org admin of the owning org.
-- Viewers are explicitly excluded — they have a protocol_members row
-- but with role='viewer', which doesn't satisfy the IN ('coordinator',
-- 'member') predicate.
USING (
  EXISTS (
    SELECT 1 FROM protocol_members pm
    WHERE pm.protocol_id = protocol_messages.protocol_id
      AND pm.user_id = auth.uid()
      AND pm.role IN ('coordinator', 'member')
  )
  OR EXISTS (
    SELECT 1 FROM protocols p
    WHERE p.id = protocol_messages.protocol_id
      AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
  )
);

-- INSERT: same access + author_user_id = self.

-- DELETE: author self, org admin, or protocol coordinator.

-- No UPDATE policy — messages are immutable in v1, same as org_messages.
```

### Channel discovery for the UI

`listMyChatProtocols(orgId)` returns the list of protocols the current
user can chat in:
- Org admins: every protocol in the org (implicit access)
- Non-admins: protocols where they have `protocol_members.role IN ('coordinator', 'member')`

Returns `[{ id, code, name }]` so the sidebar can render `# {code}`
labels with `{name}` as the `title` tooltip.

### Sidebar UX

Slack-style collapsible left rail inside the Chat tab:

- **Wide state** (default): ~220px-wide sidebar with channel labels. Each
  channel is a clickable row showing `#` + code (or `general` for the
  org-wide channel). Active channel highlighted.
- **Collapsed state**: ~48px-wide icon-only column. Same clicks. Tooltips
  on hover show the full label.
- **Toggle**: chevron button at the top of the sidebar.

Channel list structure (top to bottom):
1. `#general` (always — the OrgChatContext channel from PR 4a)
2. *divider*
3. `#{code}` per accessible protocol (alphabetical by code)

On narrow viewports (<640px), the sidebar collapses to icon-only by
default; user can still expand it.

Persists in localStorage:
- `piq-chat-channel-v1` → `'general' | <protocol_id>` (default `'general'`)
- `piq-chat-sidebar-wide-v1` → `'true' | 'false'` (default `'true'`)

### Context layout — parallel, not unified

Keep `OrgChatContext` exactly as it is for `#general` (no changes).
Add a new `ProtocolChatContext` that manages a single "currently-active
protocol channel": `activeProtocolId`, `messages`, `loading`, `error`,
`postMessage(body)`, `setActiveProtocolId(id | null)`. When
`activeProtocolId` changes, the context unsubscribes from the old
channel and subscribes to the new one. Idle (null) → no subscription.

`ChatTab` consumes both contexts and renders whichever is active. The
sidebar drives `setActiveProtocolId` on click.

This is intentionally not a unified context — keeping `OrgChatContext`
untouched protects the working `#general` flow, and the cost of a
parallel context is one extra file (small structural duplication
because the data shapes are nearly identical).

## Scope (files allowed)

### New

- `supabase/migrations/2026XXXX_protocol_messages.sql` — schema + RLS + realtime publication.
- `src/lib/orgs/protocolMessagesAdapter.ts` — pure mapper.
- `src/lib/orgs/__tests__/protocolMessagesAdapter.test.ts` — sibling test (required by mechanical check for new adapter).
- `src/context/ProtocolChatContext.tsx` — realtime subscription + state for the active protocol channel.
- `plans/kiara/organization-chat-per-protocol.md` — this file.

### Modified

- `src/types/orgs/index.ts` — `ProtocolMessage`, `NewProtocolMessageInput`, `ChatProtocolSummary` (for the sidebar list).
- `src/lib/orgs/orgsApi.ts` — `listProtocolMessages`, `postProtocolMessage`, `listMyChatProtocols`.
- `src/App.tsx` — wrap tree with `<ProtocolChatProvider>` inside `<OrgChatProvider>` (same nesting depth as before, one level deeper).
- `src/components/dashboard/organization/ChatTab.tsx` — collapsible sidebar + channel switching. The existing org-general message rendering moves into a shared subcomponent so the protocol-channel rendering can reuse it.

### Out of scope

- Channel notifications / unread counts — future PR. Adds non-trivial state and "last seen" tracking; not needed for v1.
- Threads, reactions, file uploads, mentions — future.
- Cross-channel search — future.
- Auto-create a protocol channel when a protocol is created — not needed since RLS-only model has no per-channel row to create; every protocol is implicitly a channel the moment a `protocol_messages` row lands.

## Architecture layers touched

- [x] migration
- [ ] RPC
- [x] adapter
- [x] context
- [x] component
- [x] test (new sibling)

## Mock data plan

None. Demo mode users (no `activeOrg`) see the empty chat state from PR 4a; this PR doesn't change that path.

## Approved-by

- `@rg-dev-piqc` — new migration under `supabase/migrations/`.
- `@ish-dev-piqc` — `src/App.tsx` (shared chrome; 2-reviewer rule). Change is one additional provider in the existing nest.

## Verification

- `npx supabase db push --linked` applies the new migration cleanly.
- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors.
- `npx vitest run` → adapter test passes; existing tests still green.
- Manual, two browsers as two different protocol members:
  - Both see the protocol channel in their sidebar
  - User A posts → appears immediately in A's window; in B's window within ~1s (realtime)
  - Right-aligned self bubbles, left-aligned with author name for others (same as `#general`)
  - Enter sends; Shift+Enter inserts a newline
- Viewer access check: invite a third user as `viewer` on the protocol → they should NOT see the channel in their sidebar (excluded by client-side filter) AND a direct query attempt should return zero messages (RLS).
- Org admin access check: an admin who isn't in `protocol_members` for the protocol still sees the channel in their sidebar and can read + post.
- Sidebar toggle: collapse → channels show as icons only; expand restores labels. State survives refresh.
- Channel selection: choose a protocol channel → refresh → still on that channel. If the persisted channel id no longer exists (lost access), falls back to `#general`.
