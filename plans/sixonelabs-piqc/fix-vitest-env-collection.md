---
owner: sixonelabs-piqc
feature: fix-vitest-env-collection
status: active
started: 2026-07-03
target_pr:
---

# Fix vitest collection crash when no .env exists

## Context

`src/lib/supabase.ts` calls `createClient(import.meta.env.VITE_SUPABASE_URL, ...)` at module top level, so on a checkout with no real `.env` (only `.env.example`), every test file that transitively imports it dies at collection with `Error: supabaseUrl is required.` — 10 collection errors across sotr components, visit-execution APIs, ProtocolContext, and orgs adapters at 965bb82. Fix: inject dummy `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` via `test.env` in `vitest.config.ts` so the client constructs harmlessly; tests that actually exercise the client already `vi.mock` it (see `src/lib/orgs/__tests__/orgEventsApi.test.ts`). Least-invasive alternative to ~12 files of per-test `vi.mock('src/lib/supabase')` churn, and keeps Roger's `src/lib/supabase.ts` untouched.

## Scope (files allowed)

Files this feature is allowed to touch. `piqc-review` blocks if changes go outside this list.

- vitest.config.ts
- src/components/sotr/__tests__/DownloadDraftPacketButton.test.tsx
- plans/sixonelabs-piqc/fix-vitest-env-collection.md

Scope expansion (2026-07-04): with the env injection in place, `DownloadDraftPacketButton.test.tsx` no longer fast-crashes at collection — its `async vi.mock` + `vi.importActual` factory now deadlocks the vitest worker and hangs the whole suite (reproduced in isolation under both `--pool=forks` and `--pool=threads`; every other formerly-crashing file completes, including three that import the real unmocked client). The factory's `...actual` spread is unnecessary — the component imports only `downloadDraftConfidencePacket`, which the factory replaces — so the fix is a sync factory with no `importActual`. One-hunk test-only change, no assertion changes.

## Out of scope (files forbidden)

Explicit forbidden files in the same domain. Any file not in Scope is also implicitly out-of-scope.

- src/lib/supabase.ts (@rv61 — the test.env approach exists precisely to avoid touching it)
- src/test/setup.ts (owned by active plan fix-vitest-cleanup)
- src/**/__tests__/** except DownloadDraftPacketButton.test.tsx above (stale assertions are fix-stale-test-assertions' concern; no per-test vi.mock churn)
- .env / .env.example (no real credentials involved anywhere)

## Architecture layers touched

- [ ] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [x] test (`src/**/__tests__/`) — test runner config only, no test files

## Mock data plan

none — dummy env strings for the test process, not mock app data. No localStorage toggle involved.

## Approved-by

- `vitest.config.ts` has no CODEOWNERS entry (shared root config). Noted here per shared-file convention; tag reviewers on the PR.
- @ish-dev-piqc — for src/components/sotr/__tests__/DownloadDraftPacketButton.test.tsx (SOTR components owner; mock-factory deadlock fix, no assertion changes; tag on PR)
- @rv61 — FYI only: his `src/lib/supabase.ts` is the module being unblocked but is deliberately not edited.
- Overlap note: `plans/ishika/ingest-async.md` (in-review) lists `vitest.config.ts` for an `include`-pattern change that already landed via PR #105; no live conflict.

## Verification

How to test end-to-end. Filled in before opening the PR.

- [x] Full `npx vitest run`: zero `supabaseUrl is required.` occurrences (baseline at 965bb82: 10) and the run completes in ~4s — no hang
- [x] All previously-uncollectable files now collect and run: 82 files / 975 tests (baseline 798), 887 pass. Failure-list diff: ZERO newly-failing files; 5 files fully fixed (visitExecutionApi, visitExecutionExportApi, visitExecutionMutationsApi, ProtocolContext.race, DownloadDraftPacketButton — 6/6 green after the seam rewrite)
- [x] Remaining 21 failing files + 3 unhandled errors (NewAuditDrawer `listSites` mock drift) all pre-exist in baseline and are owned by fix-stale-test-assertions / fix-vitest-cleanup
- [x] `tsc --noEmit -p tsconfig.app.json` and `eslint` on both changed files: clean
- [x] Deadlock bisect record (for reviewers): hoisted factory, sync factory, bare automock, and vi.doMock of the exportApi module id ALL deadlock the worker (empty JS stacks, parent+worker idle — vitest 2.1.9 mocker bug); mocking reviewApi from the same file works; unmocked exportApi evaluates fine; cache purge / singleFork / no-isolate / threads pool don't help. Hence the supabase-seam mock.
