---
owner: ish-dev-piqc
feature: demo-visit-prep
status: merged
merged: 2026-06-16
started: 2026-06-16
target_pr: #371
---

# Fix: Visit Prep tab empty in demo mode for all 3 protocols

## Context

With demo mode on, the Visit Prep (Visit Execution) tab showed nothing for any protocol. Two reasons: (1) Visit Execution is gated by a *separate* dev toggle `piq-visit-execution-mock-v1` (`isMockEnabled()`), not by demo mode — so demo sessions hit the real `visit_execution_get_workspace` RPC with demo protocol ids and got nothing back; (2) even with the mock on, `getMockVisitExecutionWorkspaces` only built workspaces for the primary demo protocol (PP06489), returning `[]` for CLR_18_06 and ND-L02-s0201-005.

## Approach (all in `src/lib/visit-execution/`, Ishika-owned)

- `visitExecutionApi.ts` — `isMockEnabled()` now also returns true when Demo Mode is active (`piq-demo-active-v1 === '1'`, the server-gated bit set by DemoModeContext), so Visit Prep shows fixtures in demo like every other surface. Dev toggle still works.
- `mockVisitWorkspace.ts` — keep the rich curated PP06489 workspaces; add a generic builder that derives a Visit-Prep workspace for the other demo protocols straight from their (re-themed) visit templates — each procedure becomes an execution item with a keyword-based phase/classification. `getMockVisitExecutionWorkspaces` now covers all 3 demo protocol ids; non-demo protocols still return `[]`.
- Regression test: `isMockEnabled()` true under demo bit; all 3 demo protocols return non-empty workspaces (with items) and never call `supabase.rpc`.

## Scope (files allowed)

- src/lib/visit-execution/visitExecutionApi.ts
- src/lib/visit-execution/mockVisitWorkspace.ts
- src/lib/visit-execution/__tests__/visitExecutionApi.test.ts

## Out of scope (files forbidden)

- src/components/dashboard/visit-execution/
- src/lib/demo/
- src/context/

## Architecture layers touched

- [x] test (`src/**/__tests__/`)
- visit-execution lib (`src/lib/visit-execution/`)

## Mock data plan

Uses the existing visit-execution mock fixture; now also activated by the demo seam (`piq-demo-active-v1`). No new toggle.

## Approved-by

- n/a — all files under `/src/lib/visit-execution/` (Ishika).

## Verification

- [x] `tsc --noEmit` exit 0; all visit-execution tests pass (incl. new demo-coverage test).
- [ ] Demo user, toggle on: Visit Prep tab populated for PP06489, CLR_18_06, and ND-L02-s0201-005.
