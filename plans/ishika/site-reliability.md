---
owner: ish-dev-piqc
feature: site-reliability
status: in-review
started: 2026-05-18
target_pr: 92
---

# Site reliability: Reducto failure surfacing + visit-status durability

## Context

Two known issues flagged in the master plan §4.2 + §4.3:

**B3.1 — Reducto Extract failure swallowing.** `supabase/functions/ingest/index.ts` does `extractClinicalFields(...).catch(() => null)`. When Reducto's Extract pass fails (malformed response, timeout, schema mismatch), the error is silently swallowed and the document is marked `status='ready'` despite having no extracted fields. The user sees an empty SOTR drawer with no signal and no retry path. Commit `964c9a4` flagged this as "pre-existing problem, next sprint" — this is next sprint.

**B3.2 — Visit status lost on re-materialization.** `materialize_protocol_visits` (migration `20260507000000`) wipes ALL template-derived visits with `DELETE FROM site_visits WHERE template_id IS NOT NULL OR is_seed=TRUE`, then re-inserts. A coordinator who has marked a visit `completed` loses that work if the protocol is re-projected (e.g., when a participant's `enrolled_at` changes — which the auto-trigger fires on). A comment in `src/lib/site/siteApi.ts:247-250` acknowledges this.

## What the fix does

### B3.1: Strict Reducto Extract failure

Replace the `.catch(() => null)` with an explicit try/catch that throws on failure. The outer error handler at `ingest/index.ts:~1417` already catches thrown errors, sets `documents.status='failed'`, populates `error_message`, and returns a non-200 response to the client. The client's `UploadForm` already renders error state from the response body — so the user sees a clear message and can retry.

The strict-fail trade-off: even if Reducto Parse succeeded (chunks are searchable), we discard the whole ingest on Extract failure. The reason — without `extracted_fields`, the SOTR drawer is empty, the auto-tag trigger doesn't fire, the schedule-of-events table stays blank. A half-baked document is worse than a clear failure the user can retry.

### B3.2: Materialize preserves non-scheduled rows

New migration that replaces `materialize_protocol_visits`. Key changes:

1. **DELETE only `scheduled` template-derived rows** (the ones that are safe to recompute — they haven't been acted on yet). Visits with status `completed`, `missed`, `deviation`, `overdue`, or `closing_soon` represent real coordinator work and stay put.
2. **Still DELETE `is_seed=TRUE` rows** — those are demo placeholders, never user data.
3. **Skip insertion** for any (participant_id, template_id) pair that already has a row in `site_visits` (because we just preserved a completed/missed visit for that slot).

Result: a coordinator who completed Week 2 for participant P-0019 keeps that completion through any number of re-projections.

## Scope (files allowed)

- `supabase/functions/ingest/index.ts`
- `supabase/migrations/20260519010000_materialize_preserves_status.sql` (NEW)
- `plans/ishika/site-reliability.md`

## Out of scope (files forbidden)

- All other `src/` files. B3 is two surgical fixes, nothing else.
- Modifying the original `20260507000000_protocol_visit_templates.sql` (append-only rule — new migration overrides the RPC).
- Backfilling existing failed-but-marked-ready documents — not blocking; future cleanup script if it ever matters.

## Architecture layers touched

- [x] migration (1 new file)
- [x] RPC (the materialize function gets rewritten via CREATE OR REPLACE)
- [ ] adapter
- [ ] context
- [ ] component (no UI change needed — UploadForm already renders the error state)
- [ ] test

No `src/types/<domain>/` impact — no schema columns added or removed.

## Mock data plan

None. Pure backend fixes.

## Approved-by

- @rv61 — `supabase/migrations/**` + `supabase/functions/ingest/**` are Roger's domain.

## Verification

### B3.1

- [ ] Force a Reducto Extract failure (e.g., by injecting an invalid Reducto API key or a malformed PDF that parses but extract-fails). Upload a PDF.
- [ ] Confirm the API response is non-200 with an error body.
- [ ] Confirm `documents.status='failed'` + `error_message` is populated for that row.
- [ ] Confirm the UploadForm renders the error in red.

### B3.2

- [ ] On a fresh demo protocol with templates, materialize visits.
- [ ] Mark one visit `status='completed'` via the Start-visit workflow.
- [ ] Trigger re-materialization (change a participant's `enrolled_at` to fire the trigger, OR call the RPC directly).
- [ ] SELECT the visit — status should still be `completed`, not reverted to `scheduled`.
- [ ] Confirm other template visits that were `scheduled` correctly recompute (in case their window changed).
