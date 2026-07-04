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
- plans/sixonelabs-piqc/fix-vitest-env-collection.md

## Out of scope (files forbidden)

Explicit forbidden files in the same domain. Any file not in Scope is also implicitly out-of-scope.

- src/lib/supabase.ts (@rv61 — the test.env approach exists precisely to avoid touching it)
- src/test/setup.ts (owned by active plan fix-vitest-cleanup)
- src/**/__tests__/** (stale assertions are fix-stale-test-assertions' concern; no per-test vi.mock churn)
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
- @rv61 — FYI only: his `src/lib/supabase.ts` is the module being unblocked but is deliberately not edited.
- Overlap note: `plans/ishika/ingest-async.md` (in-review) lists `vitest.config.ts` for an `include`-pattern change that already landed via PR #105; no live conflict.

## Verification

How to test end-to-end. Filled in before opening the PR.

- [ ] Full `npx vitest run`: zero `supabaseUrl is required.` occurrences (baseline at 965bb82: 10)
- [ ] The 9 previously-uncollectable files now collect and run; failure-list diff shows no new failures introduced by the env injection
- [ ] Remaining failures are exactly the pre-existing stale-assertion / RTL-cleanup sets owned by fix-stale-test-assertions and fix-vitest-cleanup
