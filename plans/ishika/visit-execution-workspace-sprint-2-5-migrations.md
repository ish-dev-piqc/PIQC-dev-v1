---
owner: ish-dev-piqc
feature: visit-execution-workspace-sprint-2-5-migrations
status: in-review
started: 2026-05-26
target_pr: 123
---

# Visit Execution Workspace — Sprint 2.5: Migrations

## Context

Sprint 2 (PR #121) merged the canonical schema design doc at `docs/visit-execution/canonical-schema.md`. Roger approved the design by merging. This PR implements the 7 migrations the doc specified in §10. All changes are additive — no existing table is modified. Sprint 3 (parser integration) is the next sprint and depends on these tables existing.

## Scope (files allowed)

- `supabase/migrations/20260601000000_visit_execution_enums.sql`
- `supabase/migrations/20260601000100_visit_requirements_table.sql`
- `supabase/migrations/20260601000200_visit_conditional_rules_table.sql`
- `supabase/migrations/20260601000300_visit_timing_rules_table.sql`
- `supabase/migrations/20260601000400_visit_source_fields_table.sql`
- `supabase/migrations/20260601000500_visit_requirement_human_edits_table.sql`
- `supabase/migrations/20260601000600_visit_execution_rpcs.sql`

## Out of scope (files forbidden)

- All existing migrations — append-only rule; never modify a merged migration
- `src/types/visit-execution/index.ts` — already mirrors what's being created; no diff needed (the doc was designed FROM these types). Sprint 3 will update the adapter/API to consume the new tables; this PR does not.
- `src/lib/visit-execution/visitExecutionAdapter.ts` — Sprint 3 territory
- `src/lib/visit-execution/visitExecutionApi.ts` — Sprint 3 territory
- `supabase/functions/ingest/index.ts` — Sprint 3 will extend the CLINICAL_EXTRACT_SCHEMA; not this PR
- `docs/visit-execution/canonical-schema.md` — Roger-approved doc; do not modify

## Architecture layers touched

- [x] migration (`supabase/migrations/` — 6 table migrations)
- [x] RPC (one combined RPC migration)
- [ ] adapter
- [ ] context
- [ ] component
- [ ] test (per PIQC convention, RPCs are exercised via integration smoke; no separate test files)

## Mock data plan

None. Pure schema work.

## Approved-by

- **@rv61** (Roger) — all changes in `/supabase/`. He's already on board with the design (merged #121); this PR is the implementation he gated.

## Schema corrections from design-doc verification

The design doc proposed `protocols.owner_user_id` in RLS predicates. Live schema uses `protocols.owner_id`. The migrations use the actual column name and follow the canonical RLS pattern from [`20260520000200_owner_scoped_rls_v2.sql`](../../supabase/migrations/20260520000200_owner_scoped_rls_v2.sql):

```sql
owner_id = auth.uid()
OR owner_org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
```

For child tables (visit_requirements, conditional_rules, timing_rules, source_fields, human_edits), the predicate joins through `protocol_visit_templates` → `protocols`.

## TS type mirror (per CLAUDE.md rule)

No new TypeScript types needed. The Sprint 1 type file (`src/types/visit-execution/index.ts`) was the input to the design doc. All Postgres enums and table columns mirror existing types one-to-one. Adapter / API consumption of the real tables is Sprint 3 work.

## Verification

- [ ] `supabase db push` applies cleanly against a fresh local DB
- [ ] `supabase db reset` followed by push succeeds (no migration ordering issues)
- [ ] Each new table has RLS enabled and an owner policy that joins to `protocols`
- [ ] `visit_requirements` retains the `derived_text` / `current_text` separation
- [ ] `visit_requirement_human_edits` is append-only and has reviewer + version + protocol context columns mirroring `worksheet_review_events`
- [ ] `visit_execution_get_workspace(p_protocol_id)` returns the same shape `VisitExecutionWorkspace` defined in `src/types/visit-execution/index.ts` (JSON keys match TypeScript field names exactly)
- [ ] `piqc-review` passes
