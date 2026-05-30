# Visit Prep — ingest → execution pipeline fixes

status: active
Approved-by: Roger (required — touches `supabase/functions/` + `supabase/migrations/`)

## Context

"Visit Prep" (Visit Execution Workspace) rendered empty for real protocols: visits showed with
**0 requirements**, empty role filters, no worksheet items. Audit (35 gaps) traced it to three
compounding bugs:

1. **No requirements data** — existing protocols were ingested before the visit-execution schema
   existed, so `visit_requirements` was never written. The fallback path also emitted `role_hint: null`.
2. **138 templates from ~21 visits** — the template upsert passed a batch with duplicate
   `(visit_name, study_day)` keys straight to `.upsert(onConflict)`; Postgres can't touch a row twice
   per statement, so dupes multiplied across re-ingests.
3. **Invisible failures** — `persistVisitExecutionWorkspaces` caught/swallowed every error and still
   marked the doc `status='ready'` → "empty tab, no error."

## Done on this branch (`feat/demo-mode-polish`)

Code changes (commit `54deb01`) — **active only after deploy** (edge functions) / frontend build:
- `ingestPipeline.ts`: in-array dedup before template upsert; drop null/empty-label procedures;
  Reducto extract prompt now requests `role_hint`; warn when persist writes 0 requirements.
- `VisitExecutionTab.tsx`: honest "Requirements not extracted yet — re-ingest" empty-state when a
  visit's workspace has 0 items (was a bare 0-item checklist).

DB already applied this session (separate commits): visit-execution + org-workspaces schema caught
up to main; `get_workspace` → SECURITY DEFINER (6s→74ms); pgcrypto enabled; RLS-v3 old policies dropped.

## Deploy-gated runbook (Roger) — do IN THIS ORDER

1. **Deploy edge functions** so the dedup + extraction fixes are live:
   `supabase functions deploy ingest ingest-status ingest-recover` (and any sharing `_shared`).
   *Cleanup/backfill before this just re-multiplies dupes — deploy first.*

2. **Clean up existing duplicate templates** (destructive; FKs verified safe — `site_visits.template_id`
   SET NULL, requirement/signal tables empty so CASCADE is a no-op). Scope to affected protocols or run
   global:
   ```sql
   DELETE FROM public.protocol_visit_templates t
   USING (
     SELECT protocol_id, visit_name, study_day, MIN(id) AS keep_id
     FROM public.protocol_visit_templates
     GROUP BY protocol_id, visit_name, study_day
     HAVING COUNT(*) > 1
   ) dup
   WHERE t.protocol_id = dup.protocol_id AND t.visit_name = dup.visit_name
     AND t.study_day = dup.study_day AND t.id <> dup.keep_id;
   ```
   (PP06489 `f44d6614…` should drop 138 → ~21; ND `8e8329a5…` 51 → ~18.)

3. **Backfill `visit_requirements`** for pre-existing protocols: for each, `extractClinicalFields(reducto_job_id, reductoKey)`
   (exists, `ingestPipeline.ts:1759`) → `persistVisitExecutionWorkspaces`. Free re-extract when
   `reducto_job_id` present (both of Ishika's have it); re-upload the PDF if absent. Quickest packaging:
   a small `/backfill-visit-execution` edge function taking `protocol_id | all | not_done`.

4. **Verify**: reload Visit Prep — ~21 visits, requirements populated, role chips real. If
   `requirements_written=0`, check logs for `[ingest] vew_persist_zero_requirements` / `vew_persist_rpc_failed`.

## Remaining gaps (post-runbook)

- **P1 (Roger):** `ingest_error_log` table + surface via `/ingest-status` (stop swallowing — highest-leverage
  observability fix); `reducto_job_id` expiry handling; persist-RPC idempotency integration test.
- **P1 (Ishika):** TS↔SQL `normalizeDerivedText` parity test (drift silently breaks re-ingest fingerprint match).
- **P2 (Ishika):** remaining empty-state polish (snapshot card, stat grid, role-filter, navigator messaging).

## Verification

`npm run typecheck` clean; frontend empty-state visible on localhost now; pipeline fixes verified after
deploy via the runbook step 4.
