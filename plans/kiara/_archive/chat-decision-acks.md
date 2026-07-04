---
owner: ki-dev-piqc
feature: chat-decision-acks
status: merged
merged: 2026-06-04
started: 2026-06-04
target_pr: #277
---

# Chat: read confirmation on decisions

## Context

Decision capture already lets users promote a chat message to a
durable, immutable decision. Clinical trial workflows often need a
stronger signal — not just "we made this decision" but "everyone who
needs to know has acknowledged it." For example: a protocol amendment
that the PI, all sub-investigators, and the coordinator must ack
before it goes into effect.

This PR adds optional read-confirmation requirements per decision:
the creator can pick a list of users who must explicitly acknowledge,
and the decision view tracks progress.

Second feature in the clinical-trial-distinctive sequence (file
uploads was #1; cross-mode references is #3).

## Design

### Schema

```
chat_decision_acks (
  id                 uuid pk default gen_random_uuid(),
  decision_id        uuid not null references chat_decisions(id) on delete cascade,
  required_user_id   uuid not null references auth.users(id) on delete cascade,
  acknowledged_at    timestamptz,
  acknowledged_note  text check (acknowledged_note is null or length(acknowledged_note) <= 2000),
  created_at         timestamptz not null default now(),
  unique (decision_id, required_user_id)
)
```

Indexes: `(required_user_id, acknowledged_at)` for the per-user
pending-acks query.

### RLS

- **SELECT** — anyone who can read the parent decision (i.e., anyone
  with channel access). Same predicate as `chat_decisions` SELECT;
  delegated via an `EXISTS (SELECT FROM chat_decisions WHERE id = decision_id)`
  subquery (RLS evaluates that as the caller, so cascades naturally).
- **INSERT** — the decision's `created_by_user_id` only. Anyone could
  otherwise add fake ack requirements to other people's decisions.
- **UPDATE** — only the `required_user_id` can update their own row's
  `acknowledged_at` + `acknowledged_note`. (Used to flip from null →
  now() when they acknowledge.)
- **DELETE** — decision creator or org admin (in case a required user
  is wrong, the creator can remove and re-add).

### Promote flow updates

`DecisionPromoteModal` gains a final field — "Require acknowledgment
from" — a multi-select chip picker showing chat-eligible members of
the channel (same picker shape as the @-mention list). Default:
empty. Picking 0 users keeps the decision informational (no acks
needed). Picking 1+ users creates ack requirements.

On submit:
1. Insert the decision row (existing path).
2. If `requiredUserIds.length > 0`, insert `chat_decision_acks` rows
   in parallel for each user. Failures bubble up as a warning banner
   but the decision still exists.

### Decision list updates

In `DecisionList`, each decision shows:

- Existing fields: title, rationale, decided by, decided at
- NEW: ack progress — `Acknowledged 2 of 5` with an inline chip list:
  - Acknowledged users: green chip with name + check icon
  - Pending users: grey chip with name + clock icon
- If the current user is in the pending list, a prominent
  "Acknowledge" button below the rationale. Click → opens a small
  inline form with an optional note + Confirm.
- If the current user is a pending acker and clicks Confirm, the
  realtime UPDATE event arrives → their chip flips from pending to
  acknowledged in everyone's view.

For decisions with no required acks, the section is omitted entirely
(informational decisions render as today).

### DECISION pill update

The DECISION pill above the source message shows an extra dot when
that decision has pending acks. Amber dot for "some users haven't
acked yet"; green check when everyone has. Click → opens the panel
scrolled to that decision.

### Realtime

`useChatDecisions` already subscribes to `chat_decisions` INSERT/
DELETE per channel. Extend with a parallel sub on `chat_decision_acks`
filtered by `decision_id IN (channel's decision ids)`. New ack rows
on INSERT update the in-memory map; UPDATEs (acknowledged_at change)
update the same map.

## Scope (files allowed)

### New

- `supabase/migrations/2026XXXX_chat_decision_acks.sql` — table,
  RLS, indexes, realtime publication.
- `src/lib/orgs/chatDecisionAcksAdapter.ts` — pure row mapper.
- `src/lib/orgs/__tests__/chatDecisionAcksAdapter.test.ts` — sibling test.
- `plans/kiara/chat-decision-acks.md` — this file.

### Modified

- `src/types/orgs/index.ts` — `ChatDecisionAck` type +
  `requiredUserIds` field on `NewChatDecisionInput`.
- `src/lib/orgs/orgsApi.ts` — `createDecisionAcks(decisionId, userIds[])`,
  `acknowledgeDecision(ackId, note?)`,
  `listDecisionAcks(decisionIds[])`. Extend
  `createChatDecision` to optionally accept `requiredUserIds` and do
  the followup ack inserts inline.
- `src/hooks/useChatDecisions.ts` — also fetch + sub
  `chat_decision_acks` for the channel's decisions; return
  `acksByDecisionId: Map<decisionId, ChatDecisionAck[]>`.
- `src/components/dashboard/organization/chat/DecisionPromoteModal.tsx`
  — multi-select picker for required users.
- `src/components/dashboard/organization/chat/DecisionList.tsx` —
  ack progress + Acknowledge button.
- `src/components/dashboard/organization/ChatTab.tsx` — DECISION
  pill adapts color/icon based on ack progress for the displayed
  decision; no other changes.

### Out of scope (future)

- Global "you have decisions to ack" badge in the Navbar — same
  shape as the mentions notification badge but a separate
  notification context. Worth doing as a follow-up; keeping scope
  tight here.
- Email notifications when ack is required.
- Ack-grouping (e.g., "any 2 of N" instead of "all N"). v1 requires
  all named users to ack.
- Time-bound ack expiry. v1 acks are open-ended.
- Edit/revoke acks. v1 acks are immutable once set
  (mentioned_at + note are writable only on the null → set transition).

## Architecture layers touched

- [x] migration
- [ ] RPC
- [x] adapter
- [x] component (modal + list + ChatTab pill tweak)
- [x] test (sibling adapter test)
- [ ] context (lives in the existing useChatDecisions hook)

## Mock data plan

None.

## Approved-by

- `@rg-dev-piqc` — new migration in `supabase/migrations/`.

## Verification

- `npx supabase db push --linked` applies cleanly.
- `npx tsc --noEmit --skipLibCheck -p tsconfig.app.json` → 0 errors.
- `npx vitest run` → adapter test passes.
- Manual (three browsers as different members):
  - User A promotes a chat message to a decision; in the modal,
    selects users B and C as required acks. Submit.
  - In all three browsers, the decision appears with progress
    "Acknowledged 0 of 2" and B + C show as pending chips.
  - In B's browser, the decision shows a prominent Acknowledge
    button. Click → expanded inline form → optional note → Confirm.
  - Within ~1s, A and C see B's chip flip to acknowledged ("✓ B
    acknowledged"). Progress now shows 1 of 2.
  - C acknowledges → progress shows 2 of 2; DECISION pill's
    indicator flips to green check.
- Non-required user (D, who can see the channel but isn't in the ack
  list) sees the progress but no Acknowledge button.
- Viewer on protocol — still can't see the decision at all (RLS).
- RLS:
  - User E (not the decision creator) tries to INSERT a fake ack
    requirement → denied.
  - User F (a required acker) tries to update another required user's
    row → denied.
