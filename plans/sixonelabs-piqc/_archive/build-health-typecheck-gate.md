---
owner: sixonelabs-piqc
feature: build-health-typecheck-gate
status: merged
started: 2026-07-06
merged: 2026-07-08
target_pr:
---

# Build health — typecheck + test CI gate, suite green

## Context

Nothing in CI ran `tsc` or `vitest` (`piqc-discipline` = greps; `deploy` = vite build, which skips
type errors). Type-broken code merged to main twice (CRA tab union) and a test-cleanup regression
left 20 test files failing unnoticed. This lands tsc + vitest as required CI steps and makes the
suite green so the gate can be hard from day one.

## Scope (files allowed)

- .github/workflows/piqc-discipline.yml
- vitest.config.ts
- src/test/setup.ts
- src/App.tsx
- src/components/Navbar.tsx
- src/components/dashboard/__tests__/DashboardChat.test.tsx
- src/components/dashboard/audit/__tests__/AuditChatPanel.test.tsx
- src/components/dashboard/audit/onboarding/__tests__/NewAuditDrawer.test.tsx
- src/components/dashboard/audit/stages/__tests__/ReportDraftingWorkspace.test.tsx
- src/components/sotr/__tests__/WorksheetItemsList.test.tsx

## Out of scope (files forbidden)

- website/
- supabase/migrations/
- src/lib/ (non-test)
- All non-test component behavior (tests lock CURRENT behavior; zero product-code semantics change
  — the only src changes are two type-level syncs: BACK_LABELS key + Navbar callback union)

## Architecture layers touched

- [ ] migration / RPC / adapter / context
- [x] component (type-only: App.tsx record key, Navbar prop union)
- [x] test (setup cleanup hook, stale mocks, drifted assertions)
- [x] CI (.github/workflows/piqc-discipline.yml — typecheck + vitest steps in the required job)

## Mock data plan

none (dummy supabase env vars in vitest.config are test plumbing, not app mocks)

## Approved-by

- @ish-dev-piqc @ki-dev-piqc — .github/workflows (shared-infra 2-reviewer) + App.tsx/Navbar type sync
- @karl-dev-piqc — audit test repairs (AuditChatPanel, NewAuditDrawer, ReportDrafting hoist fix)
- @ish-dev-piqc — SOTR test mock repair (WorksheetItemsList)

## Verification

- [x] `tsc --noEmit -p tsconfig.app.json` exits 0 (was: 3 errors)
- [ ] full vitest suite green (was: 20 failed files / 19 failed tests + 3 errors)
- [ ] CI runs typecheck + vitest inside `mechanical-checks` (required context; no settings change)
- [x] Deno test excluded from vitest (runs via `deno test`, per its own header)
