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

## Scope (files allowed)

Files this feature is allowed to touch. `piqc-review` blocks if changes go outside this list.

- src/test/setup.ts

## Out of scope (files forbidden)

Explicit forbidden files in the same domain. Any file not in Scope is also implicitly out-of-scope.

- vitest.config.ts (keeps `globals: false` — no config change needed)
- src/components/dashboard/audit/onboarding/__tests__/NewAuditDrawer.test.tsx (tests are correct; the setup is at fault)

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

none needed — `src/test/setup.ts` has no CODEOWNERS entry (shared test infra).

## Verification

- [ ] `npx vitest run src/components/dashboard/audit/onboarding/__tests__/NewAuditDrawer.test.tsx` — all tests pass, no duplicate-element errors
- [ ] `npx vitest run` — full suite passes; confirms no other test file relied on cross-test DOM state
