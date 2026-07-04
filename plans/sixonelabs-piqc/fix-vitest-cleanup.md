---
owner: sixonelabs-piqc
feature: fix-vitest-cleanup
status: active
started: 2026-07-03
target_pr:
---

# Fix missing RTL cleanup in vitest setup

## Context

Two `NewAuditDrawer.test.tsx` tests fail locally with "Found multiple elements with the placeholder text of: /Q2 2026 ePRO platform audit/i". `vitest.config.ts` sets `globals: false`, so @testing-library/react's auto-cleanup — which registers only when a global `afterEach` exists at import time — never runs, and each test's `render()` accumulates in the DOM. Registering `cleanup` explicitly in the shared setup file fixes it while keeping `globals: false`. Pre-existing at 464aa56, unrelated to PR #404.

Discovered during verification: PR #404 (1bf814e) added `listSites()` to `NewAuditDrawer.tsx`'s bootstrap `Promise.all` without updating the test's `vi.mock` factory, so once cleanup works, all three tests fail on "Unable to find role option Vendor One" (the bootstrap effect rejects and vendors never populate). Scope expanded to update the mock — two lines, test file only.

## Scope (files allowed)

Files this feature is allowed to touch. `piqc-review` blocks if changes go outside this list.

- src/test/setup.ts
- src/components/dashboard/audit/onboarding/__tests__/NewAuditDrawer.test.tsx

The test-file change is mock drift only (PR #404): add `listSites`/`createSite` to the `auditCreationApi` mock factory + a `listSites` resolved value in beforeEach. No assertion changes.

## Out of scope (files forbidden)

Explicit forbidden files in the same domain. Any file not in Scope is also implicitly out-of-scope.

- vitest.config.ts (keeps `globals: false` — no config change needed)
- src/components/dashboard/audit/onboarding/NewAuditDrawer.tsx (component is correct; the mock is stale)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [x] test (`src/**/__tests__/`) — shared test setup only

## Mock data plan

none

## Approved-by

- @karl-dev-piqc — for src/components/dashboard/audit/onboarding/__tests__/NewAuditDrawer.test.tsx (Audit Mode owner; tag on PR)
- `src/test/setup.ts` has no CODEOWNERS entry (shared test infra).

## Verification

- [x] `npx vitest run src/components/dashboard/audit/onboarding/__tests__/NewAuditDrawer.test.tsx` — all 3 tests pass, no duplicate-element errors
- [x] `npx vitest run` — before/after failure-list diff: the fix removed 19 failing entries (PiqcDock, PrefillAgentNote, ReviewStatusBadge, WorksheetItemRow, NewAuditDrawer — all DOM-accumulation victims) and added zero. Remaining failures are pre-existing: `supabaseUrl is required.` collection errors from missing `.env` (only `.env.example` exists locally) + a handful of stale pure-function assertions (e.g. `exportApi.test.ts` disclaimer regex matches "approval" in the new disclaimer copy). Neither is affected by this change.
