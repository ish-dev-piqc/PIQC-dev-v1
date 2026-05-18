---
owner: ish-dev-piqc
feature: discipline-workflow-baseline
status: in-review
started: 2026-05-18
target_pr: 87
---

# Discipline workflow: realistic baseline against the existing codebase

## Context

The `piqc-discipline` workflow (PR #83) was written without first auditing `main` against its own rules. The workflow only runs on PRs, never on `main` itself, so every pre-existing violation has been invisible. PR #85 (`feat/site-demo-mode`) is the first PR to hit a real codebase and surface them all. PR #86 fixed the first one (cross-mode SOTR widgets). This PR fixes the rest.

Full audit ran every file-scanning check against `main`'s tree (commit `e8d6c2e`, post-#86 merge):

| Check | Status | Violations on main |
|---|---|---|
| Cross-mode imports | ✅ PASS | (fixed in #86) |
| Raw Tailwind colors | ✅ PASS | 0 |
| **Components must not import supabase** | ❌ FAIL | **8 files** |
| Adapters must be pure | ✅ PASS | 0 |
| Realtime in components | ✅ PASS | 0 |
| **`any` in src/lib** | ❌ FAIL | **2 lines (both in tests)** |
| Vitest timestamp litter | ✅ PASS | 0 |

(Diff-based checks — migrations append-only, console.log, plan-MD reference, type-mirror — only fire on PR changes, not on main itself, and pass for PR #85.)

## What the fix does

### Components must not import supabase — 3-layer exemption

1. **Skip type-only imports** (`import type {...}`) — type-only imports get erased at compile time, never appear at runtime, and never make a fetch. The rule's purpose ("don't fetch in components") doesn't apply to types.
2. **Allowlist `src/components/auth/**`** — auth UI's coupling to Supabase Auth is fundamental. There's no Api layer that could meaningfully wrap `supabase.auth.signInWithPassword`. This is intrinsic, not debt.
3. **Allowlist 4 known-debt files** — `Chatbot.tsx`, `dashboard/Dashboard.tsx`, `dashboard/DashboardChat.tsx`, `dashboard/KnowledgeBase.tsx`. Each currently imports the supabase client or stream helpers from `lib/supabase`. The right fix is to extract their fetch logic into Api files, but that's a separate refactor. The allowlist names them explicitly so any NEW component-supabase import will still fail.

The 8th violation (`AskTab.tsx`) is type-only and falls under (1).

### `any` in src/lib — exclude tests

`any` in production code is correctly forbidden. In test files, `as any` is a common, documented pattern for mocking the Supabase client's complex types (the offenders in `src/lib/sotr/__tests__/protocolPdfApi.test.ts` have explicit `// eslint-disable-next-line` comments showing intentional use). Restrict the rule to non-test code by excluding `__tests__/` and `.test.` from the scan.

## Scope (files allowed)

- `.github/workflows/piqc-discipline.yml`
- `plans/ishika/discipline-workflow-baseline.md`

## Out of scope (files forbidden)

- Any `src/` file. This is a CI-only fix; no application code changes.
- Refactoring the 4 known-debt files to remove their supabase imports — that's a follow-up per file.
- Other workflow checks not listed above (cross-mode is already done in #86).

## Architecture layers touched

- [ ] migration
- [ ] RPC
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test
- [x] CI workflow (mechanical-checks job in piqc-discipline.yml)

## Mock data plan

None. CI-only change.

## Approved-by

None required. Workflow file isn't in CODEOWNERS; conceptual owner is @ish-dev-piqc (author of this PR).

## Verification

- [ ] Locally re-run every file-scanning check against the current main tree → all pass.
- [ ] Locally simulate fresh violations on a throwaway branch (new component importing `supabase`, new `as any` in non-test lib code) → both still fail as expected.
- [ ] PR #85's CI re-run completes all gates green (or surfaces only the type-mirror warning, which is informational).

## Follow-ups (separate plans)

- Refactor `Chatbot.tsx` + `DashboardChat.tsx` to move `streamChatFunction` / `streamDashboardChat` into a shared `src/lib/chat/chatApi.ts`. Remove their `lib/supabase` imports. Then remove them from this allowlist.
- Refactor `Dashboard.tsx` sign-in widget at line 159 into either auth context or a small auth Api. Remove from allowlist.
- Refactor `KnowledgeBase.tsx` upload flow into an ingest Api. Remove from allowlist.
