---
owner: ish-dev-piqc
feature: visit-execution-workspace-sprint-3-5a-schema-and-rewire
status: active
started: 2026-05-26
target_pr:
---

# Visit Execution Workspace — Sprint 3.5a: Schema deltas + RPC + frontend type extension

## Context

Sprint 3 (PR #124) shipped the parser-integration design doc. Sprint 3.5 implements it. Per the doc's §13 estimate, the full Sprint 3.5 is ~2-3 days of focused work spanning migrations, RPC update, ingest pipeline (1200-line edit), adapter rewire, and types — too heavy for one review pass.

Sprint 3.5a is the **schema + frontend half**: the 4 new migrations from §8, the `visit_execution_get_workspace` body update from §8.5, plus the TypeScript type extensions, mock-fixture updates, and adapter/API tweaks needed to consume the new fields. Roger reviews 5 SQL files only. Sprint 3.5b (the ingest pipeline rewrite) follows after this lands.

When 3.5a merges: frontend lights up with the new shapes; real RPC reads return empty arrays for `completeness_signals` and NULL for `purpose` because no ingest writes to the new tables yet. The mock toggle (`piq-visit-execution-mock-v1`) still drives demo data.

## Scope (files allowed)

- `supabase/migrations/20260615000000_visit_templates_add_purpose.sql`
- `supabase/migrations/20260615000100_visit_signal_resolution_enum.sql`
- `supabase/migrations/20260615000200_visit_completeness_signals_table.sql`
- `supabase/migrations/20260615000300_visit_requirement_drift_log_table.sql`
- `supabase/migrations/20260615000400_visit_execution_get_workspace_v2.sql`
- `src/types/visit-execution/index.ts`
- `src/lib/visit-execution/mockVisitWorkspace.ts`
- `src/lib/visit-execution/visitExecutionAdapter.ts`
- `src/lib/visit-execution/visitExecutionApi.ts`
- `src/lib/visit-execution/__tests__/visitExecutionAdapter.test.ts`
- `src/lib/visit-execution/__tests__/visitExecutionApi.test.ts`
- `plans/ishika/visit-execution-workspace-sprint-3-5a-schema-and-rewire.md`

## Out of scope (files forbidden)

- `supabase/functions/_shared/ingestPipeline.ts` — Sprint 3.5b territory (the CLINICAL_EXTRACT_SCHEMA extension + LLM passes go there)
- `supabase/functions/_shared/sourceEvidenceAdapter.ts` — Roger's territory, no need to touch in 3.5a
- `supabase/functions/ingest/index.ts` — Roger's territory
- `supabase/migrations/20260601000600_visit_execution_rpcs.sql` — already merged; do not modify (append-only rule). RPC update lives in a new migration file
- `src/components/dashboard/visit-execution/` — UI changes deferred; types are additive and existing components still compile
- `docs/visit-execution/parser-integration.md` — the design doc is the source of truth; do not edit

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`supabase/migrations/20260615000400_*.sql`)
- [x] adapter (`src/lib/visit-execution/visitExecutionAdapter.ts`)
- [ ] context
- [ ] component
- [x] test (`src/lib/visit-execution/__tests__/`)

Plus types (`src/types/visit-execution/index.ts`).

## Mock data plan

No new mock surface. Existing `piq-visit-execution-mock-v1` localStorage toggle (defined in `visitExecutionApi.ts`) continues to drive demo data. The mock fixture in `mockVisitWorkspace.ts` is extended with the new fields (`purpose`, `parser_confidence`, per-item `confidence_state`, an example `completeness_signals` array on at least one visit) so the UI has something to render in mock mode.

## Approved-by

- `@rv61` (Roger) — for all 5 files under `supabase/migrations/`. Same pattern as Sprint 2.5 (PR #123) — Roger reviews the SQL; Ishika owns the rest.

## Verification

- [ ] `supabase db reset` applies all 5 migrations cleanly on a fresh DB
- [ ] `protocol_visit_templates.purpose` and `protocol_visit_templates.parser_confidence` exist and accept NULL (pre-Sprint-3.5b rows are unaffected)
- [ ] `visit_signal_resolution` enum exists with values `pending`, `added_as_requirement`, `dismissed_not_real`
- [ ] `visit_completeness_signals` and `visit_requirement_drift_log` tables exist with RLS predicates that follow the same `protocol → owner_id / owner_org_id` chain as `visit_requirements`
- [ ] `visit_execution_get_workspace` RPC returns the new `purpose`, `parser_confidence`, per-item `confidence_state`, and `completeness_signals` fields (empty / NULL on real data, populated from fixture in mock mode)
- [ ] `npm run build` passes (strict TypeScript)
- [ ] `npm run test -- visit-execution` — adapter + api tests pass, including new cases for the new fields
- [ ] `npx tsc --noEmit` — zero unused-import / type warnings
- [ ] `piqc-review` passes all checks
- [ ] Mock toggle (`localStorage.setItem('piq-visit-execution-mock-v1', '1')`) still renders the BRIGHTEN-2 workspace; new fields visible in dev preview if any UI surfaces them (none in 3.5a — additive types only)
