---
owner: ish-dev-piqc
feature: visit-execution-workspace-sprint-3-5b-parser-ingest
status: merged
merged: 2026-05-27
started: 2026-05-26
target_pr: #131
---

# Visit Execution Workspace — Sprint 3.5b: Parser Ingest Implementation

## Context

Implements `docs/visit-execution/parser-integration.md` §3-§9. Sprint 3.5a (PR #127) landed the schema + frontend types; 3.5b lands the ingest-pipeline writes that populate those tables from real protocol PDFs, plus the API rewire that flips the read path from the thin adapter to the v2 RPC.

After this lands: real `visit_requirements` rows + child rules + completeness signals get written on every protocol parse, the frontend reads them via `visit_execution_get_workspace`, and the mock toggle becomes opt-in-only (default off → real data).

## Scope (files allowed)

- `supabase/migrations/20260615000500_visit_execution_persist_rpc.sql` — NEW. The atomic-persist RPC that wraps `visit_requirements` + child rules + `visit_completeness_signals` writes in a single transaction.
- `supabase/functions/_shared/ingestPipeline.ts` — Roger-owned. Extend `CLINICAL_EXTRACT_SCHEMA`, add LLM helpers (purpose-prose, missing-req detection), add `sanitize()` / `normalize()` / `fingerprintRequirement()` helpers, add new persistence step calling the new RPC.
- `supabase/functions/_shared/__tests__/ingestPipeline.test.ts` — NEW. Deno tests for the pure helpers (`sanitize`, `normalize`, `fingerprintRequirement`, validation of LLM output shapes). LLM calls themselves are not unit-tested here.
- `src/lib/visit-execution/visitExecutionApi.ts` — Ishika-owned. Switch the non-mock path from `fetchVisitTemplates + adapter` to `supabase.rpc('visit_execution_get_workspace')`.
- `src/lib/visit-execution/__tests__/visitExecutionApi.test.ts` — Update tests for the new real-path branch.
- `plans/ishika/visit-execution-workspace-sprint-3-5b-parser-ingest.md` — this plan.

## Out of scope (files forbidden)

- `supabase/functions/ingest/index.ts`, `ingest-recover/index.ts`, `reducto-webhook/index.ts` — they call `processIngestCompletion()` already; no changes needed.
- `supabase/functions/_shared/sourceEvidenceAdapter.ts`, `sotrTypes.ts` — SOTR adapter; not touched.
- Existing migrations (append-only rule).
- `src/lib/visit-execution/visitExecutionAdapter.ts` — kept as the mock-mode-only mapper per design doc §9.2. No changes.
- `src/lib/visit-execution/mockVisitWorkspace.ts` — fixture unchanged.
- `src/types/visit-execution/index.ts` — shapes already match the v2 RPC from 3.5a.
- `src/components/dashboard/visit-execution/` — UI unchanged.
- `docs/visit-execution/parser-integration.md` — design doc stays as merged in #124; the `parser_confidence` → `confidence_state` doc sync from 3.5a's divergence note is still a pending follow-up (out of scope here).

## Architecture layers touched

- [x] migration (`supabase/migrations/20260615000500_*.sql`)
- [x] RPC (atomic-persist function)
- [ ] adapter (intentionally not touched — mock-only role per design doc)
- [ ] context
- [ ] component
- [x] test (Deno + Vitest)

Plus the Reducto extract schema + LLM call wiring in the shared ingest pipeline.

## Implementation outline

1. **Extend `CLINICAL_EXTRACT_SCHEMA`** (`ingestPipeline.ts` line ~348) — additive: each `schedule_of_events` entry gets `visit_purpose: string` and `procedures_structured: ProcedureStructured[]` per design doc §3.1. Existing `procedures: string[]` stays for backward compatibility.
2. **Pure helpers** in `ingestPipeline.ts`:
   - `sanitize(text: string)` — strips control chars, collapses whitespace, optionally blocks high-risk phrases. Wraps interpolated text in `<protocol_text>` markers at call sites.
   - `normalizeDerivedText(text: string)` — lowercase + collapse whitespace + trim (idempotency key).
   - `fingerprintRequirement(visitTemplateId, normalizedText)` — SHA-256 over `visit_template_id || '|' || normalizedText`.
   - `assignPhase(label, description)` / `assignClassification(label)` — heuristic rule tables per §3.3.
3. **LLM helpers** in `ingestPipeline.ts`:
   - `generateVisitPurpose(visitContextText, openaiKey)` → string | null. gpt-4o-mini, temperature 0.3, max 200 tokens. Mock-injection mitigations applied.
   - `detectMissingRequirements(visit, extractedList, contextText, openaiKey)` → `Array<{ gap_text, source_section, source_page, confidence, reason }>`. gpt-4o-mini, JSON-mode, max 800 tokens.
   - Both wrapped in `withRetry` + timeout. On failure: function returns `null`/`[]` and the pipeline writes a `'needs_review'` signal explaining the gap.
4. **Step 5b — Visit Execution Workspace persistence** in `processIngestCompletion()`:
   - After templates upsert (line ~1156).
   - For each `protocol_visit_template` just inserted/updated: gather the matching `schedule_of_events` entry, compute `procedures_structured`, call both LLMs (in parallel per visit for latency), then call the new atomic RPC with the assembled payload.
   - Wrap in `try/catch` — failures log + continue (best-effort, mirrors §6.3 spirit per visit rather than transaction-spanning-all-visits).
5. **New RPC `visit_execution_persist_parsed_workspace(p_protocol_id, p_visits)`** — SECURITY DEFINER (called from edge function with service role; protocol ownership already verified by step 5 above). Returns `{ visits_written, requirements_written, signals_written }`. Body:
   - For each visit in `p_visits`: UPDATE `protocol_visit_templates` (purpose, confidence_state).
   - For each procedure: upsert `visit_requirements` keyed by `(visit_template_id, derived_text_fingerprint)` — preserves `current_text`, `review_status`, `version` when matched.
   - Wipe + re-insert `visit_conditional_rules` / `visit_timing_rules` / `visit_source_fields` for affected requirements (parser-derived per §7.1).
   - Detect drift: if `current_text IS NOT NULL` and incoming `derived_text` differs, append to `visit_requirement_drift_log` (preserves human edit).
   - Upsert `visit_completeness_signals` with `(visit_template_id, gap_text)` UNIQUE.
   - All in one PL/pgSQL function body = one implicit transaction.
6. **Frontend rewire** in `visitExecutionApi.ts`:
   - Mock-on path unchanged.
   - Mock-off path: replace `fetchVisitTemplates + adaptVisitTemplates` with `supabase.rpc('visit_execution_get_workspace', { p_protocol_id })`. Cast the `workspaces` array to `VisitExecutionWorkspace[]`. Return `Result<T>`.
   - Update sibling test for the new real-path branch.

## Mock data plan

No new mock surface. Existing `piq-visit-execution-mock-v1` toggle preserved; mock fixture unchanged from 3.5a. Real-data path now actually returns real data (instead of the bridge passthrough from procedures TEXT[]).

## Approved-by

- `@rv61` (Roger) — for all `supabase/` files (1 migration + 1 edge-function module edit + 1 Deno test file). Heaviest review surface in the VEW arc; design doc PR #124 set the spec.

## Decision debt (deferred to Sprint 4)

- **Orphan `visit_requirements` rows on amendment.** If a protocol amendment REMOVES a requirement, the existing row stays in the DB with no signal that it's obsolete. The workspace shows outdated data; the coordinator has no way to tell. Deferred because destroying a human-reviewed row destroys the audit trail; the safe path is to mark the row (new `review_status = 'amendment_removed'` enum value, or a drift_log event of type `'amendment_removed'`) rather than DELETE. Sprint 4 must address this — it's not just a polish item.
- **`protocol_visit_templates.confidence_state` always NULL on first ingest.** The LLM passes don't emit a visit-level confidence; the column stays NULL until Sprint 4 wires Reducto's per-field confidence into the persist payload.
- **`completeness_signal_count` rollup on RPC v2.** Sprint 3.5a added the rollup field; this PR doesn't add a count-vs-array agreement test against real data. Worth a CI smoke when integration tests exist.

## Verification

- [ ] `supabase db reset` applies all migrations cleanly; the new persist RPC exists with the documented signature
- [ ] Re-parsing an existing demo protocol writes `visit_requirements` rows; querying `visit_execution_get_workspace(p_protocol_id)` returns the workspace with rich items + (initially empty / NULL) purpose + signals
- [ ] LLM calls succeed for at least one visit → `protocol_visit_templates.purpose` is populated; `visit_completeness_signals` may have rows (depending on whether the LLM found real gaps)
- [ ] LLM failure path: persist RPC still writes `visit_requirements`; the affected visit gets a `'needs_review'` completeness signal explaining "coverage_check_unavailable"
- [ ] Re-ingest preserves `current_text` and `review_status` on human-edited rows; drift log captures the parser delta
- [ ] `npm run build` passes (strict TS)
- [ ] `npm run test -- visit-execution` passes (updated API test for the RPC path)
- [ ] `deno test supabase/functions/_shared/` passes (sanitize + fingerprint + normalize)
- [ ] CI `piqc-discipline.yml` green
- [ ] Mock toggle (`localStorage.setItem('piq-visit-execution-mock-v1', '1')`) still renders BRIGHTEN-2 workspace
- [ ] Mock toggle OFF → workspace shows real data for a real ingested protocol (manual smoke test by Roger or Ishika post-deploy)
