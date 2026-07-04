---
owner: sixonelabs-piqc
feature: build-health-gates
status: active
started: 2026-07-03
target_pr:
---

# Build health: test suite green from a fresh clone + CI quality gates

## Context

Absorbed and extends `fix-vitest-cleanup` (same branch). Three layered problems made local/CI test signal meaningless: (1) with `globals: false`, RTL auto-cleanup never registered, so DOM leaked across tests — 19 test entries across 5 suites failed on duplicates; (2) no `.env` exists on fresh clones and `src/lib/supabase.ts` throws at import, so 14 of 82 test files failed at collection and 177 tests never ran; (3) CI executes zero project code — piqc-discipline.yml is grep-only, so a PR breaking every test and tsc merges green. This plan fixes the setup, injects dummy test env, repairs the mock drift and a vi.mock TDZ bug the env fix exposes, and adds a `quality-gates` CI job (typecheck + test + build) plus a duplicate-migration-version check.

## Scope (files allowed)

- src/test/setup.ts
- src/components/dashboard/audit/onboarding/__tests__/NewAuditDrawer.test.tsx
- vitest.config.ts
- package.json
- .github/workflows/piqc-discipline.yml
- src/components/dashboard/audit/stages/__tests__/ReportDraftingWorkspace.test.tsx
- src/components/sotr/__tests__/WorksheetItemsList.test.tsx
- src/components/dashboard/audit/__tests__/AuditChatPanel.test.tsx

All test-file changes are mock/expectation repairs only (missing mock exports for PR #404's `listSites`/`createSite`, PR-era `isAwaitingReview` drift, a `vi.hoisted` TDZ fix, stale spy-arg/testid expectations) — no assertion-weakening, no component changes.

## Out of scope (files forbidden)

- src/components/dashboard/audit/onboarding/NewAuditDrawer.tsx (component is correct; mocks were stale)
- src/lib/** (no production code changes)
- The 8 test files with the 10 known stale assertions — being fixed in a parallel session (plans/sixonelabs-piqc/fix-stale-test-assertions on its own branch)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [x] test (`src/**/__tests__/`) + test config + CI workflow

## Mock data plan

none (test-only vi.mock factories; dummy `VITE_SUPABASE_*` values in vitest config are test-runner env, not app mocks)

## Approved-by

- @karl-dev-piqc — audit test files (NewAuditDrawer, ReportDraftingWorkspace, AuditChatPanel tests)
- @ish-dev-piqc — src/components/sotr test file + .github/workflows change (discipline package adjacency)

## Verification

- [ ] `npm run test` with NO .env present: 0 collection errors; only failures are the 10 known stale assertions being fixed on the parallel branch (0 after both merge)
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run build` — passes (now includes tsc)
- [ ] quality-gates CI job runs on this PR and typecheck/build steps pass
