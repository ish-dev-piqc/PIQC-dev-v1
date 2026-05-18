---
owner: rv61
feature: piqc-thread-persistence
status: active
started: 2026-05-18
target_pr:
---

# PIQC Thread Persistence — close the amnesia gap

## Context

PIQC's F-3 chat thread has lived in `AuditWorkspaceShell` state since PR #73; reload, sign-out, or tab-close lost the conversation. This was a deliberate v1 simplification (see `product_piqc_vision_audit_chat.md`) but it broke the on-shoulder-partner illusion. This feature persists the thread per audit so an auditor returning picks up exactly where they left off. Final functional leg of the PIQC arc.

## Scope (files allowed)

- `supabase/migrations/20260518000000_piqc_thread_messages.sql`
- `src/lib/audit/piqcThreadApi.ts`
- `src/lib/audit/__tests__/piqcThreadApi.test.ts`
- `src/components/dashboard/audit/AuditWorkspaceShell.tsx`
- `plans/roger/piqc-thread-persistence.md`

## Out of scope (files forbidden)

Any other Audit Mode file — Karl's lane. In particular:

- `src/components/dashboard/audit/AuditChatPanel.tsx` (the panel itself isn't touched; the shell owns thread state today)
- `src/lib/audit/chatApi.ts` (only consumed via the existing `AuditChatMessage` type)
- `src/lib/audit/signalsApi.ts`, `src/hooks/usePiqcSignals.ts`
- Any `stages/` workspace
- All Site Mode and SOTR surfaces (mode isolation)
- `src/context/` (no new context introduced; shell-level state is the right home for chat-thread orchestration)

## Architecture layers touched

- [x] migration (`supabase/migrations/`) — new `piqc_thread_messages` table, RLS, and `save_piqc_thread` RPC
- [x] RPC — `save_piqc_thread(audit_id, messages JSONB)` is part of the migration
- [ ] adapter — N/A; small surface, no row-shape transformation beyond CHECK-constraint validation
- [ ] context — not needed; thread state already lives in `AuditWorkspaceShell` and the panel consumes via props
- [x] component (shell) — two new useEffects on `AuditWorkspaceShell.tsx`: hydrate-on-audit-switch and debounce-save
- [x] test — `src/lib/audit/__tests__/piqcThreadApi.test.ts`

## Mock data plan

None. Real Supabase reads/writes from the moment the migration lands.

## DB schema → TS type mirror

**No type impact.** The persisted shape (`role`, `content`) maps onto the existing `AuditChatMessage` type in `src/lib/audit/chatApi.ts`; no new TypeScript type file under `src/types/audit/` is needed. The fetcher returns `AuditChatMessage[]` directly.

## Approved-by

- @karl-dev-piqc — owns `src/lib/audit/` and `src/components/dashboard/audit/`; this feature adds `piqcThreadApi.ts` to his lane and adds two effects to `AuditWorkspaceShell.tsx`

## Verification

- [ ] `supabase db push` applies the migration cleanly on a fresh DB
- [ ] Open an audit, send 3 turns, close tab, reopen → thread re-hydrates from DB
- [ ] Sign out, sign back in, reopen the same audit → thread re-hydrates
- [ ] Switch audit A → B → A → A's thread re-hydrates (cross-audit cleanup + re-fetch path)
- [ ] Send a fast turn DURING initial hydration → both history and the new turn are present (merge-on-race path)
- [ ] RLS spot-check: log in as a different auditor on a different audit → cannot read or write the first auditor's threads
- [ ] No `[piqcThreadApi]` errors in dev console during happy paths
- [ ] `npm test -- piqcThreadApi` passes
