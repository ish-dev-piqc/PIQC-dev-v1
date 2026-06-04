---
owner: ki-dev-piqc
feature: chat-decision-capture
status: active
started: 2026-06-04
target_pr:
---

# Chat: decision capture — promote message to a Decision

## Context

Clinical-trial workflows generate decisions in chat: "we'll skip Visit 5
for participant P-0023 because of X", "Maya is the new PI for PP06489",
"protocol amendment lands on Aug 1". Today these live as plain chat
messages that drift up the scroll buffer and have no audit trail.

This PR adds first-class **Decisions** as a chat primitive. Any chat
message can be promoted to a Decision with a title and optional
rationale. The decision persists in its own table (immutable for audit),
linked to the source message but surviving its deletion. The source
message renders with a `DECISION` pill so the conversation context is
visible. A per-channel decisions list shows the audit trail.

This is the differentiating clinical-trial feature vs generic chat.
Slack doesn't have it. Microsoft Teams doesn't have it. This is why
PIQClinical's chat exists at all.

## Design

### Schema

```
chat_decisions (
  id                            uuid pk default gen_random_uuid(),
  title                         text not null check (length(title) between 1 and 200),
  rationale                     text check (length(rationale) <= 4000),

  -- Channel reference — exactly one set.
  org_id                        uuid references orgs(id) on delete cascade,
  protocol_id                   uuid references protocols(id) on delete cascade,

  -- Source message — nullable so decisions survive message deletion.
  source_org_message_id         uuid references org_messages(id) on delete set null,
  source_protocol_message_id    uuid references protocol_messages(id) on delete set null,

  decided_by_user_id            uuid references auth.users(id) on delete set null,
  decided_at                    timestamptz not null default now(),
  created_by_user_id            uuid references auth.users(id) on delete set null,
  created_at                    timestamptz not null default now(),

  -- Channel xor matches the message-table xor used by chat_mentions.
  check (
    (org_id is not null and protocol_id is null)
    or
    (org_id is null and protocol_id is not null)
  )
)
```

Indexes: `(org_id, decided_at DESC)`, `(protocol_id, decided_at DESC)`,
`(source_org_message_id)`, `(source_protocol_message_id)`.

### RLS

- **SELECT** — caller can chat in the channel:
  - For `org_id` decisions: caller is in `org_members`.
  - For `protocol_id` decisions: caller is in `protocol_members` with
    role `coordinator`/`member`, OR caller is an org admin of the
    protocol's owning org.
- **INSERT** — same channel-access predicate + `created_by_user_id = auth.uid()`.
- **UPDATE** — none. Decisions are immutable for audit.
- **DELETE** — org admin only (basic moderation / mistakes).

### Promote flow

Each rendered chat message gets a hover `⋯` button (already a pattern
in the org-page surfaces). The menu has a single action for v1:
**Promote to decision**.

Clicking opens a modal:
- **Title** (required, ≤200 chars; defaults to the first ~50 chars of
  the message body)
- **Rationale** (optional, ≤4000 chars; defaults to empty)
- **Decided by** (defaults to the message author; can be changed to
  any chat-eligible member of the channel)
- **Decided at** (defaults to the message's `created_at`; admins can
  backdate if "the decision was made on this date, just recorded today")

Submit calls `createChatDecision`, the row inserts, and the modal
closes. The source message immediately re-renders with the `DECISION`
pill (decisions list refresh via realtime).

### DECISION pill on source message

When rendering a chat message, look up by `(table, id)` whether a
decision was promoted from it. If yes, render a small pill above the
bubble: `📋 DECISION — {title}` in an amber-tinted background that
draws the eye without being noisy. Clicking the pill opens the
decisions list panel scrolled to that decision.

### Decisions panel

Channel header gains a small count: `📋 3 decisions`. Click opens a
slide-in panel from the right (or a modal on narrow viewports) listing
all decisions for the active channel, newest first:

- Title (bold)
- Rationale (truncated with "Show more")
- Decided by `{name}` on `{decided_at}`
- Captured by `{creator_name}` on `{created_at}`
- "Jump to source message" link (if source still exists)
- "Delete decision" (admin only) — confirm dialog

The panel is read-only otherwise (no edits in v1).

### Why not edit?

Edit-with-history is a feature; edit-without-history is an audit
disaster. For v1, decisions are immutable. If a decision needs
correcting, an admin deletes it and a new one gets promoted. The
deletion is intentionally admin-only so members can't quietly
rewrite decisions.

## Scope (files allowed)

### New

- `supabase/migrations/2026XXXX_chat_decisions.sql` — table, RLS,
  indexes, realtime publication.
- `src/lib/orgs/chatDecisionsAdapter.ts` — pure row mapper.
- `src/lib/orgs/__tests__/chatDecisionsAdapter.test.ts` — sibling test.
- `src/components/dashboard/organization/chat/DecisionPromoteModal.tsx` —
  the promote modal.
- `src/components/dashboard/organization/chat/DecisionList.tsx` —
  the side panel listing decisions for the active channel.
- `plans/kiara/chat-decision-capture.md` — this file.

### Modified

- `src/types/orgs/index.ts` — `ChatDecision`, `NewChatDecisionInput`.
- `src/lib/orgs/orgsApi.ts` — `createChatDecision`,
  `listChannelDecisions`, `deleteChatDecision`.
- `src/components/dashboard/organization/ChatTab.tsx` — per-message
  `⋯` menu with Promote, DECISION pill on source messages, channel
  header decisions count + click handler, mount the modal + panel.

### Out of scope

- Edit decisions (immutable).
- Multi-signer / required-ack decisions — planned for v2 alongside
  read-receipt infrastructure.
- Decision search / filter UI.
- Notifications when a decision is created (mentions of `<@user>` in
  the rationale would still pick up via the chat_mentions trigger
  if we extend that trigger to scan rationale text, but skipping for v1).
- Cross-channel decisions view (e.g. "all decisions for this protocol
  across all channels"). For v1 we have one channel per protocol
  anyway so the per-channel list IS the per-protocol view.

## Architecture layers touched

- [x] migration
- [ ] RPC (no new RPC; standard CRUD via PostgREST + RLS)
- [x] adapter
- [ ] context
- [x] component
- [x] test (sibling adapter test)

## Mock data plan

None.

## Approved-by

- `@rg-dev-piqc` — new migration in `supabase/migrations/`.

## Verification

- `npx supabase db push --linked` applies cleanly
- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors
- `npx vitest run` → chatDecisionsAdapter test passes
- Manual:
  - Hover a chat message → `⋯` button appears → "Promote to decision"
  - Modal opens with title prefilled from the body, decided-by defaults to message author
  - Submit → modal closes; source message gets the DECISION pill;
    channel header decisions count increments
  - Open the decisions panel → see the new entry with rationale + decided-by + decided-at
  - "Jump to source message" scrolls the chat to the message and briefly highlights it
  - Delete the source message (as author) → DECISION pill disappears from the chat (source is null); the decision row still appears in the panel without a jump link
  - Delete the decision (as admin) → confirmation → panel updates; DECISION pill clears from the source message
  - Realtime: post a decision in browser A → browser B's channel header count updates and panel (if open) shows the new entry within ~1s
- RLS:
  - Viewer on a protocol → can't see decisions for that protocol
  - Non-member of org → can't see #general decisions
