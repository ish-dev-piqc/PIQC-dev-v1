---
owner: ish-dev-piqc
feature: visit-execution-sprint-4a-review-state-actions
status: in-review
started: 2026-05-26
target_pr:
---

# Visit Execution — Sprint 4a: Persist review-state actions

## Context

Sprint 1 (PR #119) built the per-item ⋯ menu UI with Mark-reviewed / Unmark / Flag for review / Mark needs clarification affordances. They mutated a `useState<Map<itemId, ExecutionReviewStatus>>` in `VisitExecutionTab` — local-state-only, reset on every protocol switch.

Sprint 2.5 (PR #123) created the RPC `visit_execution_set_review_status(p_requirement_id, p_action, p_note?)` that persists the state change + appends to `visit_requirement_human_edits`.

Sprint 4a wires them together. After this lands: clicking "Mark reviewed" actually marks the requirement reviewed in the DB; refreshing the workspace shows the persisted state.

Sprint 4b (next PR) adds text-editing affordances (edit `current_text`, add site notes) — those need additional UI (modal/drawer + note input) so they're scoped separately.

## Scope (files allowed)

- `src/lib/visit-execution/visitExecutionMutationsApi.ts` — NEW. Result<T> wrappers calling `visit_execution_set_review_status` RPC.
- `src/lib/visit-execution/__tests__/visitExecutionMutationsApi.test.ts` — NEW. Tests for the wrappers (success / RPC error / argument shape).
- `src/components/dashboard/visit-execution/VisitExecutionTab.tsx` — replace local-only `handleToggleReviewed` / `handleSetStatus` with RPC-backed versions. Optimistic update + rollback on failure. Don't reset state on protocol switch (server is source of truth).
- `src/components/dashboard/visit-execution/ExecutionChecklist.tsx` — drop "Add site note" from the per-item menu (deferred to Sprint 4b which adds note-input UI). Keep "Flag for review" and "Mark needs clarification".
- `plans/ishika/visit-execution-sprint-4a-review-state-actions.md` — this plan.

## Out of scope (files forbidden)

- `supabase/` — Sprint 2.5 RPC is already on main; no migrations needed.
- `src/lib/visit-execution/visitExecutionApi.ts` — read path unchanged.
- `src/types/visit-execution/index.ts` — types unchanged.
- `src/lib/visit-execution/mockVisitWorkspace.ts` / `visitExecutionAdapter.ts` — mock path unchanged.
- `src/components/dashboard/visit-execution/TraceabilityDrawer.tsx`, `VisitSnapshotCard.tsx`, etc. — read-only surfaces, no changes.
- Anything in `src/components/dashboard/audit/` / `src/components/dashboard/sotr/` / `src/components/dashboard/site/` — mode isolation.

## Architecture layers touched

- [ ] migration — RPC already exists from Sprint 2.5
- [ ] RPC body — unchanged
- [ ] adapter — no
- [ ] context — handled via prop drilling for now (no new context)
- [x] component
- [x] test

Plus the new API module (mutation wrappers).

## Implementation outline

### 1. `visitExecutionMutationsApi.ts` (new)

Five exported async functions, all returning `Result<{ requirement_id, review_status, version, event_id }>`:

```typescript
markReviewed(requirementId: string)
unmarkReviewed(requirementId: string)
flagForReview(requirementId: string, note?: string)
markNeedsClarification(requirementId: string, note?: string)
addSiteNote(requirementId: string, note: string)  // present, used by 4b
```

All delegate to `supabase.rpc('visit_execution_set_review_status', { p_requirement_id, p_action, p_note })`. The `addSiteNote` wrapper exists for API symmetry but no UI calls it yet in 4a.

Mock mode (`isMockEnabled()`): all mutations return `{ ok: true, data: { requirement_id, review_status: <next>, version: 1, event_id: 'mock-event' } }` without hitting Supabase. Lets demo mode mutate the local view without DB writes.

### 2. `VisitExecutionTab.tsx` rewire

Change handlers from local-state-mutation to:

1. Call the matching mutation API.
2. Optimistically update local state immediately (snappy UX).
3. On RPC failure: revert + set `mutationError: string | null` shown as a dismissable banner above the checklist.

Don't reset `reviewStatus` on protocol switch — instead seed it from `i.review_status` from the fetched workspace on protocol load. That way the persisted state shows correctly without a refetch race.

Actually simpler: drop the local override Map entirely. After a successful mutation, refetch the affected workspace's items (or splice the updated row into local state). The "optimistic update" is the splice; on failure, revert by re-splicing the prior shape.

Decision: keep the override Map for optimistic UX, but seed it on workspace load with each item's persisted `review_status`. This gives instant-snappy + correct-on-refresh.

### 3. `ExecutionChecklist.tsx` menu trim

Remove "Add site note" menu item. Add a comment that it's deferred to Sprint 4b. Keep "Flag for review" and "Mark needs clarification".

Also: surface "Mark reviewed" / "Unmark reviewed" as a primary affordance on the row (currently via `onToggleReviewed`). Verify the existing checkbox/toggle UI still works through the rewired handler.

## Mock data plan

No new mock surface. Existing `piq-visit-execution-mock-v1` toggle preserved. Mutation API short-circuits in mock mode (returns a synthetic `Result<>` without hitting Supabase) so the demo UX is unchanged.

## Approved-by

None — all files Ishika-owned. No Roger review needed.

## Verification

- [ ] `npm run build` passes (strict TS)
- [ ] `npm run test -- visit-execution` passes (new mutation tests + existing read-path tests)
- [ ] CI `piqc-discipline.yml` green
- [ ] Manual smoke (real-data path, mock off):
  - Click "Mark reviewed" on an item → row visual state updates immediately + RPC fires + DB row's `review_status = 'reviewed'`
  - Refresh the page → the reviewed state persists
  - Click "Flag for review" → DB row's `review_status = 'needs_review'`; `visit_requirement_human_edits` has a new event with `action = 'flag_for_review'`
  - Simulate RPC failure (e.g. break the network) → local state reverts + banner shows error
- [ ] Manual smoke (mock mode): same actions update local state, no Supabase request observed in devtools network tab
- [ ] Re-opening the visit after a mutation shows the new state (no stale optimistic override)

## What this PR does NOT do (deferred to Sprint 4b/4c)

- Edit `current_text` (inline text editor needed)
- Add site note (note-input UI needed)
- Mark NA / not-done reasons (these are new actions; spec needs founder input on enum vs note)
- Resolve completeness signals (separate signal-resolution UI)
- Edit-log timeline drawer (read-side surface for `visit_execution_get_human_edit_log`)
