---
owner: sixonelabs-piqc
feature: fix-stale-test-assertions
status: in-review
started: 2026-07-03
target_pr:
---

# Fix 10 stale test assertions that drifted from implementation

## Context

`npx vitest run` has 10 pre-existing individual test failures at 965bb82 that are unrelated to env/.env and would fail on CI too: assertions drifted from the code they test (adapter field drift, copy drift, query-builder drift). This plan updates whichever side is stale — the tests in every case but one: `src/lib/audit/chatApi.ts` has promised "(trimmed)" in its JSDoc since its first commit but never trimmed, so there the implementation gets the one-line fix and the test stands. Notably `exportApi.test.ts`'s "no approval language" regex now trips on the deliberate advisory-only disclaimer ("Final approval, authentication, signature, and controlled release occur outside PIQC…") — per brand doctrine the disclaimer copy is correct, so the test must allow it while still guarding the rest of the export surface.

## Scope (files allowed)

Files this feature is allowed to touch. `piqc-review` blocks if changes go outside this list.

- src/lib/sotr/__tests__/exportApi.test.ts
- src/components/sotr/__tests__/WorksheetItemRow.test.tsx
- src/lib/orgs/__tests__/chatSearchAdapter.test.ts
- src/lib/orgs/__tests__/protocolMessagesAdapter.test.ts
- src/lib/orgs/__tests__/orgMessagesAdapter.test.ts
- src/lib/orgs/__tests__/chatAttachmentsAdapter.test.ts
- src/lib/orgs/__tests__/orgEventsApi.test.ts
- src/lib/audit/__tests__/chatApi.test.ts
- src/lib/audit/chatApi.ts

(`chatApi.ts` is the one implementation file in Scope: a one-line trim fix — its JSDoc + test contract has always been "trimmed reply"; the code never trimmed.)

## Out of scope (files forbidden)

Explicit forbidden files in the same domain. Any file not in Scope is also implicitly out-of-scope.

- src/lib/sotr/exportApi.ts (disclaimer copy is deliberate — advisory-only doctrine)
- src/lib/orgs/*.ts implementation files (adapters/APIs are the source of truth)
- src/components/sotr/WorksheetItemRow.tsx
- src/lib/supabase.ts, vitest.config.ts, src/test/setup.ts (env-collection failures are a separate concern, see fix-vitest-cleanup + followup)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [x] test (`src/**/__tests__/`)

## Mock data plan

none

## Approved-by

- @ki-dev-piqc — for src/lib/orgs/__tests__/* (5 files)
- @ish-dev-piqc — for src/lib/sotr/__tests__/exportApi.test.ts and src/components/sotr/__tests__/WorksheetItemRow.test.tsx
- @karl-dev-piqc — for src/lib/audit/__tests__/chatApi.test.ts and src/lib/audit/chatApi.ts

## Verification

How to test end-to-end. Filled in before opening the PR.

- [x] `npx vitest run` on the 8 target files: 72/72 pass with the pending `fix-vitest-cleanup` setup.ts change applied; 70/72 without it — the 2 remaining WorksheetItemRow failures are the RTL DOM-leak artifact that plan owns, not stale assertions
- [x] Each fixed assertion re-checked against the current implementation (not loosened blindly — exportApi regex still rejects approval/signature language outside the disclaimer sentence; WorksheetItemRow badge assertion re-pointed at ReviewStatusBadge per PR #110's deliberate confidence-chip removal; splitForHighlight trailing-'' expectation never matched any shipped implementation)
- [x] `tsc --noEmit -p tsconfig.app.json` and `eslint` on changed files: clean
