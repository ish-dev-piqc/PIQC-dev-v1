---
owner: ish-dev-piqc
feature: visit-execution-sprint-4c-signal-resolution-and-edit-log
status: merged
merged: 2026-05-27
started: 2026-05-27
target_pr: #137
---

# Visit Execution Workspace — Sprint 4c: Completeness signal resolution + edit-log timeline

## Context

Sprint 4b shipped human-editable requirement text + site notes + drift display end-to-end (PR #135). Two pending workspace stories remain from the founder's "Human Review & Editing Loop" goal:

1. **Completeness signals** — the second-pass missing-requirement detection LLM
   (Sprint 3.5b) already writes pending rows to `visit_completeness_signals` and
   the v2/v3 RPC already surfaces them on `snapshot.completeness_signals`.
   Coordinators currently can't act on them. Sprint 4c adds the resolution
   affordances (promote-to-requirement or dismiss-as-not-real).

2. **Edit-log timeline** — the audit trail of mutations is captured per
   `visit_requirements` row via `visit_requirement_human_edits` (Sprint 2.5)
   and the read RPC `visit_execution_get_human_edit_log` already exists. Site
   coordinators have no UI to see "who changed this requirement, when, and why."
   Sprint 4c adds a read-only timeline drawer.

Both stories land together because they share the workspace surface and the
overlay pattern from Sprint 4b's `RequirementTextDrawer`.

## Scope (files allowed)

Backend (NEW migration only — Roger's territory, tagged Approved-by):
- `supabase/migrations/20260616000000_visit_execution_resolve_signal_rpc.sql`

Types (Ishika-owned):
- `src/types/visit-execution/index.ts`

API + mutations (Ishika-owned):
- `src/lib/visit-execution/visitExecutionApi.ts`
- `src/lib/visit-execution/visitExecutionMutationsApi.ts`
- `src/lib/visit-execution/__tests__/visitExecutionMutationsApi.test.ts`
- `src/lib/visit-execution/__tests__/visitExecutionApi.test.ts`

Components (Ishika-owned):
- `src/components/dashboard/visit-execution/CompletenessSignalsPanel.tsx` (NEW)
- `src/components/dashboard/visit-execution/EditLogDrawer.tsx` (NEW)
- `src/components/dashboard/visit-execution/RequirementTextDrawer.tsx` (extend with `promote_signal` mode)
- `src/components/dashboard/visit-execution/ExecutionChecklist.tsx` (add `view_history` action)
- `src/components/dashboard/visit-execution/VisitExecutionTab.tsx` (mount panel + drawer; wire mutations)

Plan + memory:
- `plans/ishika/visit-execution-sprint-4c-signal-resolution-and-edit-log.md` (this file)

## Out of scope (files forbidden)

- All previously-merged migrations (append-only rule)
- `supabase/functions/_shared/ingestPipeline.ts` — Sprint 3.5b owns ingest writes
- Sprint 4 orphan-row handling (`amendment_removed` enum value) — separate followup
- `docs/visit-execution/parser-integration.md` — doc-sync is a separate PR
- Sprint 1 visual polish branch — separate rethink
- Any `src/lib/{site,audit,sotr}/*` — mode isolation
- `src/components/dashboard/visit-execution/VisitSnapshotCard.tsx` — signals panel
  mounts in VisitExecutionTab above the checklist, not inside the snapshot card
- `src/components/dashboard/visit-execution/VisitNavigator.tsx` — signal count
  already shown via existing `completeness_signal_count` chip

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (one new function: `visit_execution_resolve_completeness_signal`)
- [ ] adapter (no adapter changes — direct RPC paths)
- [ ] context (no context changes — VisitExecutionTab owns local state)
- [x] component (CompletenessSignalsPanel + EditLogDrawer + drawer mode + checklist menu)
- [x] test (mutation + read API tests)

## Mock data plan

None. Real RPC path. Mock-mode (`piq-visit-execution-mock-v1`) short-circuits the new mutations and read calls with synthetic success — same pattern as Sprint 4a/4b.

## Approved-by

- @rv61 (Roger) — for `supabase/migrations/20260616000000_visit_execution_resolve_signal_rpc.sql`

## Verification

- [ ] `npm run build` clean
- [ ] `npm test` — new mutation + API tests pass
- [ ] Mock mode: snapshot with pending signals shows the panel; "Dismiss" removes the row from the panel; "Add as requirement" opens drawer prefilled with `gap_text`, save inserts a new item into the checklist.
- [ ] Mock mode: ⋯ menu on a checklist row → "View edit history" opens read-only drawer with chronological events; before/after shown for edit_text.
- [ ] Real-data path verified against a protocol with pending completeness signals.
- [ ] `piqc-review` clean (scope, ownership, no new mocks, architecture, style, tests).
