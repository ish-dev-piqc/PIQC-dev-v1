---
owner: ish-dev-piqc
feature: visit-execution-sprint-4b-edit-text-and-notes
status: active
started: 2026-05-27
target_pr:
---

# Visit Execution — Sprint 4b: Edit text + site notes + drift display

## Context

Sprint 4a (PR #133) wired the click-only review-state actions (mark / unmark / flag). Sprint 4b adds the text-input infrastructure that 4a deferred: inline editing of `current_text`, restoration of "Add site note" + "Mark needs clarification" menu items, and drift-aware display showing `derived_text` underneath when the row is edited.

After this lands: coordinators can rewrite a requirement's display text (preserves human edit through re-ingest via Sprint 3.5b's fingerprint dedup); attach free-form notes; see when their wording diverged from the parser's output.

## Scope (files allowed)

- `supabase/migrations/20260615000600_visit_execution_get_workspace_v3.sql` — NEW. CREATE OR REPLACE of `visit_execution_get_workspace`. Signature unchanged. Body now surfaces `derived_text` separately per item (alongside the existing COALESCEd `label`) so the UI can show both when they differ.
- `src/types/visit-execution/index.ts` — extend `VisitExecutionItem` with optional `derived_text: string | null` field.
- `src/lib/visit-execution/visitExecutionMutationsApi.ts` — add `editText(requirementId, newText, note?)` wrapper around `visit_execution_edit_text` RPC. Mock-mode short-circuit consistent with 4a.
- `src/lib/visit-execution/__tests__/visitExecutionMutationsApi.test.ts` — add tests for `editText`.
- `src/lib/visit-execution/mockVisitWorkspace.ts` — set `derived_text = label` for fixture items (no real drift in the curated demo).
- `src/lib/visit-execution/visitExecutionAdapter.ts` — set `derived_text = label` in the thin adapter (Sprint 1 bridge path; no drift possible).
- `src/components/dashboard/visit-execution/RequirementTextDrawer.tsx` — NEW. Single drawer component for two modes: 'edit' (rewrite current_text) and 'note' (add site note). Reuses the existing `useOverlay` + `useSwipeDismiss` pattern from `TraceabilityDrawer`.
- `src/components/dashboard/visit-execution/VisitExecutionTab.tsx` — add drawer state + open-drawer handlers; wire confirm-button callbacks to `editText` / `addSiteNote` mutations through the existing `runReviewMutation` race-guarded helper.
- `src/components/dashboard/visit-execution/ExecutionChecklist.tsx` — restore "Add site note" + "Mark needs clarification" menu items; add "Edit text" affordance (menu item OR primary pencil button on hover — decide during build); plumb action discriminator so `mark_needs_clarification` calls the right RPC variant. Add drift-display badge / subtle helper when `current_text !== derived_text`.
- `plans/ishika/visit-execution-sprint-4b-edit-text-and-notes.md` — this plan.

## Out of scope (files forbidden)

- `supabase/functions/_shared/ingestPipeline.ts` — Roger's territory, not touched in 4b.
- `supabase/functions/` anything else — Roger's territory.
- Sprint 2.5 RPCs (`visit_execution_edit_text`, `visit_execution_set_review_status`) — already on main, signatures unchanged.
- `src/lib/visit-execution/visitExecutionApi.ts` — read path unchanged structurally (the RPC body changes but the API wrapper doesn't).
- `TraceabilityDrawer.tsx`, `VisitSnapshotCard.tsx`, `VisitNavigator.tsx`, etc. — no edits needed.
- Mode isolation: nothing under `src/components/dashboard/audit/` or `/sotr/` or `/site/`.
- Completeness signal resolution UI — Sprint 4c.
- Edit-log timeline drawer — Sprint 4c.
- Orphan-row / amendment-removed handling — separate scoped slice.

## Architecture layers touched

- [x] migration (`20260615000600_*.sql` — RPC body update)
- [x] RPC (CREATE OR REPLACE; signature unchanged)
- [ ] adapter — only the in-memory thin Sprint 1 adapter gets a default; no new mapping logic
- [ ] context
- [x] component (drawer + tab + checklist)
- [x] test

Plus types extension.

## Implementation outline

1. **Migration `20260615000600_visit_execution_get_workspace_v3.sql`** — CREATE OR REPLACE. Add `'derived_text', r.derived_text` to the item's `json_build_object`. Everything else stays from v2.
2. **Type extension** — `VisitExecutionItem.derived_text: string | null` (nullable because mock + thin-adapter rows may not have a separate value; UI treats null as "no drift").
3. **`editText` mutation API** — Result<T> wrapper over `visit_execution_edit_text` RPC. Mock-mode synthesizes success returning `review_status: 'edited'` + bumped version. Defensive payload narrowing matching the 4a pattern.
4. **`RequirementTextDrawer.tsx`** — single component with mode prop:
   - 'edit': textarea pre-filled with current label, "Save" button calls `editText(itemId, newText)`.
   - 'note': textarea blank or pre-filled with existing review_note, "Save" calls `addSiteNote(itemId, note)`.
   - Cancel button + Escape key dismisses without saving.
   - Empty/whitespace-only input disables Save (programmer-error guard; the RPC also rejects empty).
   - Loading state on Save button during RPC.
   - On error: drawer stays open, shows inline error below textarea (humanized via existing `humanizeRpcError`).
   - Reuses `useOverlay`/`useSwipeDismiss` from `TraceabilityDrawer`.
5. **`VisitExecutionTab` wiring** — two new state holders: `editingItem` / `notingItem`. Open the drawer in the right mode. On successful save: re-fetch the workspace (or splice the updated row into local state), close drawer, surface success via banner (consistent with 4a's error pattern but green).
6. **`ExecutionChecklist` menu restoration** —
   - Restore "Add site note" → opens drawer in 'note' mode for this item.
   - Restore "Mark needs clarification" → action discriminator plumbed through `onSetStatus` so the dispatcher knows to call `markNeedsClarification` rather than `flagForReview`. Probably easier: add a separate prop `onSetAction(itemId, action)` where `action: 'flag_for_review' | 'mark_needs_clarification' | ...` and keep the legacy `onSetStatus` for status-only callers.
   - Add "Edit text" → opens drawer in 'edit' mode.
   - Drift display: when `current_text` and `derived_text` are both present and differ, show a small "Edited from parser output" hint below the label (clicking expands to show derived_text inline). Subtle, not nagging.

## Mock data plan

No new mock surface. Existing `piq-visit-execution-mock-v1` toggle preserved. Mock fixture gets a `derived_text` field per item set to the same value as `label` (no drift in demo).

## Approved-by

- `@rv61` (Roger) — for `supabase/migrations/20260615000600_*.sql`. Same Sprint 2.5 / 3.5a pattern: RPC body update only, signature unchanged. Small surface.

All other files Ishika-owned.

## Verification

- [ ] `supabase db reset` applies the new migration cleanly; the v3 RPC exists with the documented added `derived_text` field per item
- [ ] `npm run build` passes (strict TS picks up the type extension)
- [ ] `npm run test -- visit-execution` passes (new `editText` tests + drawer behavior)
- [ ] CI `piqc-discipline.yml` green
- [ ] Manual smoke (mock off, real data):
  - Click "Edit text" on a row → drawer opens with current label pre-filled in textarea
  - Modify text, click Save → drawer closes; row label updates immediately; refresh page → edit persists; `visit_requirements.current_text` is set; `version` incremented; `visit_requirement_human_edits` has an `edit_text` event with `previous_text` + `new_text`
  - Drift display appears ("Edited from parser output") below the edited row
  - Click drift-display chip → reveals derived_text inline
  - Click "Add site note" → drawer opens in note mode; save → row's review_status updates to 'site_note_added'; review_note column set
  - Click "Mark needs clarification" → distinct action enum (`mark_needs_clarification`) in the audit log (not `flag_for_review`)
- [ ] Drawer cancels cleanly via X / Escape / backdrop tap
- [ ] Empty/whitespace-only input disables Save
- [ ] RPC failure: drawer stays open, inline error shown (humanized)
- [ ] Mock mode: same flows update local state, no Supabase request in devtools

## Decision-debt deferred

- Inline-edit-vs-drawer UX — going with drawer for 4b to match TraceabilityDrawer pattern. May iterate to inline expansion in a future polish PR if coordinator feedback says so.
- Edit-log timeline UI — Sprint 4c.
- Optimistic update for editText — Sprint 4a's pattern works for review_status (one of a small enum). For text, optimistic update means rendering the new text before save confirms; rollback on failure would be visually jarring mid-edit. **Decision: no optimistic update for edits.** Show "Saving..." state on the Save button, close drawer + update row on success only.
