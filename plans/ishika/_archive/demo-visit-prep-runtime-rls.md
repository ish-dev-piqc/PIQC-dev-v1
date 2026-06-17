---
owner: ish-dev-piqc
feature: demo-visit-prep-runtime-rls
status: merged
merged: 2026-06-17
started: 2026-06-16
target_pr: #375
---

# Demo Visit Prep: fetch real content at runtime (RLS), don't bundle it

## Context

The previous approach baked a carbon copy of real parsed protocol content (~440K of requirements + source quotes) into the client bundle. Anything in the bundle is publicly extractable — and it auto-deployed to a public GitHub Pages build — so the safety tooling (correctly) blocked shipping it, and it was a real IP exposure. Login-gating does NOT protect bundled data; the JS is downloaded before any auth.

This change keeps the real Visit-Prep content but **never bundles it**: demo's 3 alias protocol ids are remapped to the real protocol ids and fetched **at runtime via the existing RLS-protected RPC**. An authenticated owner/org-member sees the real workspace; anyone else gets an empty (RLS-filtered) result. Real protocol content is served per-request, gated by RLS — not embedded in the client.

## Approach (all in `src/lib/visit-execution/`)

- **Deleted** `demoVisitWorkspaces.generated.ts` (the bundled real-IP fixture).
- `mockVisitWorkspace.ts` → no-op stub (`getMockVisitExecutionWorkspaces` returns `[]`); kept only so the dev worksheet-export path compiles.
- `visitExecutionApi.ts`:
  - `DEMO_ALIAS_TO_REAL_PROTOCOL` map + `resolveProtocolId()`.
  - `fetchVisitExecutionWorkspaces` / `fetchVisitCoverage` call the RPC with the resolved REAL id; workspace `protocol_id` is re-labeled back to the alias for UI consistency.
  - `isMockEnabled()` reverted to the dev-only `piq-visit-execution-mock-v1` toggle (Demo Mode no longer routes through the static mock).
- Tests updated to the runtime-RPC + remap contract (no static fixture).

## Known limitation (intended)

Real Visit-Prep shows only to users who **own** the protocols (RLS). For the demo-flagged owner (Ishika) it renders real data; other demo accounts see empty Visit Prep. Acceptable per owner decision (the demo is shown by the owner).

## Scope (files allowed)

- src/lib/visit-execution/visitExecutionApi.ts
- src/lib/visit-execution/mockVisitWorkspace.ts
- src/lib/visit-execution/demoVisitWorkspaces.generated.ts (deleted)
- src/lib/visit-execution/__tests__/visitExecutionApi.test.ts

## Out of scope

- src/components/dashboard/visit-execution/
- src/context/, src/lib/demo/, supabase/

## Verification

- [x] `tsc --noEmit` exit 0; visit-execution tests pass (158); `vite build --base=/` runs (no longer safety-blocked; local-only `xlsx` dep missing, present in CI).
- [ ] Runtime path can only be confirmed logged in: as the protocol owner on the deployed site, Demo → Visit Prep renders the real workspaces; bundle contains no protocol content (verify via view-source).

## Follow-ups (separate)

- Real IP still exists in **git history** (commits up to a99c900) and possibly cached Pages artifacts — history rewrite needed for full purge.
- `documents` table is anon-readable (pre-existing RLS hole) — lock down (Roger).
- Rotate the `service_role` key (was pasted into a session).
