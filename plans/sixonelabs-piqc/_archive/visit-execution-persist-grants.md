---
owner: rv61
feature: visit-execution-persist-grants
status: merged
merged: 2026-09-03
started: 2026-09-03
target_pr: #601
---

# Lock `visit_execution_persist_parsed_workspace` to service_role

## Context

`visit_execution_persist_parsed_workspace` (created 20260615000500, re-created 20260714000000) is `SECURITY DEFINER`, has no ownership check in its body, and neither migration touched its grants — so it still carries Postgres's default `EXECUTE` grant to `PUBLIC`. Anyone holding the project's public key can call it and write visit requirements, child rules and completeness signals into any protocol. Confirmed reachable from the anon role on the hosted project on 2026-09-03 (empty-array early return, nothing written).

Its only caller is the ingest pipeline (`persistVisitExecutionWorkspaces` in `supabase/functions/_shared/ingestPipeline.ts`), and every edge function that runs the pipeline — `ingest`, `ingest-status`, `ingest-recover`, `reducto-webhook` — builds its client with the service-role key. So the smallest safe fix is grants-only: no user role needs `EXECUTE`, no ownership gate is added to the body, the applied definition is not replaced.

## Scope (files allowed)

- supabase/migrations/20260910000000_visit_execution_persist_grants.sql (NEW — grants only)
- plans/sixonelabs-piqc/visit-execution-persist-grants.md

## Out of scope (files forbidden)

- supabase/migrations/20260615000500_visit_execution_persist_rpc.sql and 20260714000000_vew_persist_rpc_fix.sql — applied; append-only
- supabase/functions/** — the caller already uses the service-role client; nothing to change
- src/** — no frontend surface calls this RPC
- src/types/** — grants carry no type impact

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [ ] RPC (`supabase/functions/` or `.sql`)
- [ ] adapter (`src/lib/*/*Adapter.ts`)
- [ ] context (`src/context/`)
- [ ] component (`src/components/`)
- [ ] test (`src/**/__tests__/`)

No type impact: the migration changes privileges only; no table, column, enum or function signature changes.

## Mock data plan

none

## Approved-by

None required — `supabase/` is owned by @rv61. @ish-dev-piqc is tagged on the PR as the Visit Execution surface owner and because her team applies migrations.

## Decision-debt ledger

- **Definer-grant sweep deferred.** A scan of all migrations found 60 `SECURITY DEFINER` functions and only 17 ever named in a `REVOKE`. Most of the rest gate on `auth.uid()` directly or through a helper (e.g. the orphan-cleanup pair gates on `current_user_is_any_org_admin()`), and some helpers are called from RLS policies as `authenticated`, so a blanket revoke would break policies. Triage per function in its own plan. Trigger: now, next slice.

## Verification

Pre-apply (recorded 2026-09-03): `POST /rest/v1/rpc/visit_execution_persist_parsed_workspace` with the public key and `{"p_protocol_id":"00000000-0000-0000-0000-000000000000","p_visits":[]}` returned `200` with the zero-count JSON — the hole is open.

- [ ] CI green (mechanical checks; migration is append-only; "no type impact" declared in the PR body)
- [ ] Backend applies the migration (`supabase db push`)
- [ ] Same anon probe now returns `401 / 42501 permission denied for function visit_execution_persist_parsed_workspace`
- [ ] Ingest still works end-to-end: upload a synthetic protocol → Visit Execution workspace populates (the pipeline calls the RPC as service_role); edge-function logs show no `42501` from `persistVisitExecutionWorkspaces`
- [ ] Rollback if ingest breaks: `GRANT EXECUTE … TO authenticated` restores the previous reach without reopening it to anon
