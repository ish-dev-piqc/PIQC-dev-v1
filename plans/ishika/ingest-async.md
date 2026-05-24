---
owner: ish-dev-piqc
feature: ingest-async
status: in-review
started: 2026-05-23
target_pr: 105
---

# Async ingest — Reducto polling + content-hash dedup

## Context

The current `/ingest` function holds the HTTP connection open for the entire Reducto parse + extract + embeddings + SOTR persist + B2.4 + visit-template upsert pipeline. On a 150-page clinical protocol that exceeds Supabase Edge Functions' 150-second wall-clock limit, returning `504 Gateway Timeout / IDLE_TIMEOUT`. This was verified end-to-end against prod. The architecture has to change so that parse work happens off the request-response cycle and parse duration is unbounded. The user-reload concern (don't re-parse on refresh) falls out of the same fix via content-hash dedup.

Original plan used Reducto's Svix webhook delivery for completion notification. After discovering Ishika doesn't have access to Reducto's Svix portal (which is what configures webhook destinations), the design pivoted to **polling**: same fast `/ingest` returns 202, but completion is driven by the frontend polling `/ingest-status` every 10s instead of a Reducto-→ours webhook. Per [docs.reducto.ai](https://docs.reducto.ai/api-reference/async-parse) the polling path is officially supported as an alternative.

## Scope (files allowed)

- `supabase/migrations/<timestamp>_documents_async_ingest.sql` (NEW) — add `content_hash text` + `(user_id, content_hash)` index to `documents`
- `supabase/migrations/20260523010000_org_rls_break_recursion.sql` (NEW) — pre-existing RLS infinite recursion on `org_members` / `protocol_org_access` surfaced once the auto-created protocol made the policy chain actually evaluate. Fixed via SECURITY DEFINER helpers. Hot-patched in Studio during the end-to-end verify; migration captures the same change for fresh DBs.
- `supabase/functions/ingest/index.ts` — restructure: hash + dedup-check + INSERT pending + Storage upload + kick off Reducto `/parse_async` + return 202
- `supabase/functions/ingest-status/index.ts` (NEW) — authenticated per-document poll driver. Looks up the document, asks Reducto for job status, runs `processIngestCompletion` if Reducto reports Completed, marks failed if Reducto reports Failed/Cancelled. Idempotent.
- `supabase/functions/ingest-recover/index.ts` (NEW) — authenticated safety-net endpoint called on dashboard mount. Scans the caller's documents stuck in `pending` >10min and runs the same completion pipeline.
- `supabase/functions/_shared/ingestPipeline.ts` (NEW) — factored helpers (Reducto `/parse_async` kick-off, `/extract`, `/job/{id}` result fetch, chunks+embed loop, SOTR persist RPC, B2.4 protocol auto-create, visit-template upsert, cross-doc fan-out) + the `processIngestCompletion` orchestrator. Reused by `ingest-status` and `ingest-recover`.
- `src/components/dashboard/KnowledgeBase.tsx` — `UploadForm` gains a `'parsing'` state on 202 and a `useEffect` poll loop that hits `/ingest-status` every 10s while pending. State flips to `'success'` or `'error'` when the poll reports terminal.
- `src/components/dashboard/site/ProtocolOnboarding.tsx` — SOTR-routing decision moves from `UploadForm.onSuccess` (which fires on pending, before `protocol_id` is known) to a `useEffect` keyed on `protocols.length` going 0 → 1.
- `vitest.config.ts` — broaden the `include` pattern to also pick up `supabase/functions/**/*.test.ts` (no current tests there, but the include is ready for future shared-module tests).
- `supabase/config.toml` — declare `[functions.ingest-status]` and `[functions.ingest-recover]` blocks with `verify_jwt = true` (both authenticated). `ingest` block already exists.
- `plans/ishika/ingest-async.md` — this plan.

## Out of scope (files forbidden)

- `src/lib/sotr/**` — only reads `countWorksheetItemsForStudy` (already in cross-mode allowlist, no edit)
- `src/components/dashboard/audit/**`, `src/lib/audit/**`, `src/types/audit/**` — Audit Mode untouched
- Other `supabase/functions/*` (chat, contact, etc.) — only `ingest`, `ingest-status`, `ingest-recover`, and `_shared` are touched
- `src/context/SiteDataContext.tsx` and `src/context/ProtocolContext.tsx` — existing realtime channels already do the work; no code change
- Other Site Mode tabs (Today, Visits, Participants, Team, Ask, Reports, ProtocolTab) — no edits required
- `.github/workflows/piqc-discipline.yml` — no exemption changes needed (no new cross-mode imports)

## Architecture layers touched

- [x] migration (`supabase/migrations/`) — `documents_async_ingest.sql`
- [x] RPC (`supabase/functions/`) — `ingest/`, `ingest-status/`, `ingest-recover/`, `_shared/`
- [ ] adapter — N/A
- [ ] context — N/A (existing realtime channels do the work)
- [x] component (`src/components/`) — `UploadForm` in `KnowledgeBase.tsx`, `ProtocolOnboarding.tsx`
- [ ] test — UI changes covered by manual verification. The shared pipeline is pure-function-style but exercised end-to-end via `/ingest` + `/ingest-status` against real Reducto; adding a unit test for the orchestrator would mostly assert mock behavior.

## Mock data plan

None. Real Reducto, real prod Supabase project. No localStorage toggles.

## Approved-by

- **@rv61** (Roger) — for all `supabase/functions/**` (ingest, ingest-status, ingest-recover, _shared) and `supabase/migrations/`. Primary reviewer.
- **@ki-dev-piqc** (Kiara) — for `src/components/dashboard/site/ProtocolOnboarding.tsx` (Site Mode component).
- `src/components/dashboard/KnowledgeBase.tsx` — Ishika owns (in SUPABASE_DEBT allowlist, no additional approval).

## External prerequisites (Ishika handles manually post-merge)

In strict order:

1. `supabase db push` — apply the migration (`content_hash` column).
2. `supabase functions deploy ingest ingest-status ingest-recover` — single command, all three. CLI reads `verify_jwt` per-function from `supabase/config.toml`.

**No Svix portal config, no `SVIX_WEBHOOK_SECRET`.** That was the original plan; the pivot removes both.

## Verification

End-to-end against the deployed prod functions:

- [ ] Small PDF (~5 pages): upload → 202 in <5s → UploadForm enters 'parsing' state → polling fires every 10s → eventually flips to 'success' → dashboard loads in ~30s total
- [ ] 150-page PDF: upload → 202 in <5s → 'parsing' for 2–5min → polling completes → dashboard loads (**the bug we just hit**)
- [ ] Reload during parse: re-upload same PDF → server dedup hit on `content_hash` → returns existing `document_id` with `status='pending'` → frontend re-attaches polling
- [ ] Re-upload same PDF post-parse: server dedup hit on `content_hash` → returns `status='ready'` → frontend treats as success without a second Reducto call
- [ ] Corrupt PDF: Reducto job ends with `Failed` → `/ingest-status` marks `documents.status='failed'` with error_message → UploadForm surfaces error inline
- [ ] Stuck-pending recovery: manually set a documents row to old pending state via SQL → dashboard mount triggers `/ingest-recover` → document completes
- [ ] `/piqc-review` passes locally; CI `piqc-discipline.yml` passes

## Risks (what could go sideways)

- **Free-tier 150s ceiling on `/ingest-status`'s completion run.** When Reducto reports Completed, the same `/ingest-status` invocation runs `processIngestCompletion` (extract + embed + persist + B2.4 + templates + fan-out). Fits comfortably for 150-page protocols (~80–120s of work); at 300+ pages it tightens. The `/ingest-recover` safety net catches the timeout-stuck case on next dashboard mount.
- **Client must stay open while polling.** If the user closes the tab during parse, polling stops. `/ingest-recover` catches the stuck doc on their next dashboard visit; not instant but recoverable.
- **Polling cost.** ~30 Reducto job-status calls per parse (one every 10s for ~5 min). Cheap — these are sub-second calls — but visible in usage analytics.
- **No auto-deploy on merge.** Same gotcha as today's bug — manual `supabase functions deploy` is still required. Worth adding a GitHub Action in a separate PR; not bundling here.
