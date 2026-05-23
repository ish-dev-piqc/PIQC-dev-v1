---
owner: ish-dev-piqc
feature: ingest-async
status: active
started: 2026-05-23
target_pr:
---

# Async ingest — Reducto Svix webhook + content-hash dedup

## Context

The current `/ingest` function holds the HTTP connection open for the entire Reducto parse + extract + embeddings + SOTR persist + B2.4 + visit-template upsert pipeline. On a 150-page clinical protocol that exceeds Supabase Edge Functions' 150-second wall-clock limit, returning `504 Gateway Timeout / IDLE_TIMEOUT`. This was verified end-to-end against prod today. The architecture has to change so that parse work happens off the request-response cycle and parse duration is unbounded. The user-reload concern (don't re-parse on refresh) falls out of the same fix via content-hash dedup.

## Scope (files allowed)

- `supabase/migrations/<timestamp>_documents_async_ingest.sql` (NEW) — add `content_hash text` + `reducto_parse_job_id text` to `documents`, plus `(user_id, content_hash)` index
- `supabase/functions/ingest/index.ts` — restructure: hash + dedup-check + INSERT pending row + Storage upload + kick off Reducto async with Svix webhook config + return 202
- `supabase/functions/reducto-webhook/index.ts` (NEW) — Svix-signed callback receiver. Verifies signature, idempotency-checks documents row, kicks off background processing via `EdgeRuntime.waitUntil`, returns 200 in <2s (under Svix's 15s response cap)
- `supabase/functions/ingest-recover/index.ts` (NEW) — safety-net endpoint called on dashboard mount. Polls Reducto job status for documents stuck in `pending` >10min, runs the shared pipeline if Reducto says done. Idempotent.
- `supabase/functions/_shared/ingestPipeline.ts` (NEW) — factored helpers (extract, chunks+embed loop, SOTR persist RPC, B2.4 protocol auto-create, visit-template upsert, cross-doc fan-out). Reused by `reducto-webhook` and `ingest-recover` for background completion.
- `supabase/functions/_shared/svixVerify.ts` (NEW) — Deno-native HMAC-SHA256 verification of `svix-id` / `svix-timestamp` / `svix-signature` headers, using Web Crypto. ~20 lines.
- `src/components/dashboard/KnowledgeBase.tsx` — `UploadForm` gains a `'parsing'` state. On 202 from `/ingest`, displays "Parsing your protocol — usually 30–180s. Safe to close the tab." Does NOT reset on pending. On dedup-200 (already ready), calls `onSuccess(data)` immediately.
- `src/components/dashboard/site/ProtocolOnboarding.tsx` — SOTR-routing decision moves from `UploadForm.onSuccess` (which fires on pending, before `protocol_id` is known) to a `useEffect` keyed on `protocols.length` going 0 → 1.
- `vitest.config.ts` — broaden the `include` pattern to also pick up `supabase/functions/**/*.test.ts`. Needed so the new `_shared/__tests__/svixVerify.test.ts` actually runs. Not owned by any codeowner per `docs/CODEOWNERS.md` — no additional approval.
- `plans/ishika/ingest-async.md` — this plan.

## Out of scope (files forbidden)

- `src/lib/sotr/**` — only reads `countWorksheetItemsForStudy` (already in cross-mode allowlist, no edit)
- `src/components/dashboard/audit/**`, `src/lib/audit/**`, `src/types/audit/**` — Audit Mode untouched
- Other `supabase/functions/*` (chat, contact, etc.) — only `ingest`, `reducto-webhook`, `ingest-recover`, and `_shared` are touched
- `src/context/SiteDataContext.tsx` and `src/context/ProtocolContext.tsx` — existing realtime channels already do the work; no code change
- Other Site Mode tabs (Today, Visits, Participants, Team, Ask, Reports, ProtocolTab) — no edits required
- `.github/workflows/piqc-discipline.yml` — no exemption changes needed (no new cross-mode imports)

## Architecture layers touched

- [x] migration (`supabase/migrations/`) — `documents_async_ingest.sql`
- [x] RPC (`supabase/functions/`) — `ingest/`, `reducto-webhook/`, `ingest-recover/`, `_shared/`
- [ ] adapter — N/A
- [ ] context — N/A (existing realtime channels do the work)
- [x] component (`src/components/`) — `UploadForm` in `KnowledgeBase.tsx`, `ProtocolOnboarding.tsx`
- [x] test — `_shared/__tests__/svixVerify.test.ts` (signature verification correctness against a known-good Svix fixture)

## Mock data plan

None. Real Reducto, real Svix delivery, real prod Supabase project. No localStorage toggles.

## Approved-by

- **@rv61** (Roger) — for all `supabase/functions/**` (ingest, reducto-webhook, ingest-recover, _shared) and `supabase/migrations/`. Primary reviewer.
- **@ki-dev-piqc** (Kiara) — for `src/components/dashboard/site/ProtocolOnboarding.tsx` (Site Mode component).
- `src/components/dashboard/KnowledgeBase.tsx` — Ishika owns (in SUPABASE_DEBT allowlist, no additional approval).

## External prerequisites (Ishika handles manually post-merge)

In strict order:

1. `supabase db push` — apply the migration (`content_hash` + `reducto_parse_job_id` columns).
2. `supabase functions deploy ingest` — JWT verification stays ON (clients send the user's JWT).
3. `supabase functions deploy reducto-webhook --no-verify-jwt` — **CRITICAL**: this flag is required because Svix's delivery has no Supabase JWT. Without it, every Svix callback returns 401 and silently fails.
4. `supabase functions deploy ingest-recover` — JWT verification ON (called from authenticated dashboard mounts).
5. Register webhook endpoint URL in Reducto's Svix portal: `https://<project-ref>.supabase.co/functions/v1/reducto-webhook`. Copy the signing secret.
6. `supabase secrets set SVIX_WEBHOOK_SECRET=<copied value from step 5>`.

If steps 1–6 happen out of order or any step is skipped, the system fails open in known ways (504s come back, OR webhooks fail silently). The scratch plan's "Deploy ordering" section spells out the failure modes for each misordering.

## Verification

End-to-end against the deployed prod functions (this PR can't be verified locally because Reducto needs a publicly-reachable webhook URL):

- [ ] Small PDF (~5 pages): upload → 202 in <5s → dashboard loads in ~30s total
- [ ] 150-page PDF: upload → 202 in <5s → "Parsing…" for 2–5min → dashboard loads (**the bug we just hit**)
- [ ] Reload during parse: realtime catches the eventual `status='ready'`, wall unmounts automatically. No re-parse triggered.
- [ ] Re-upload same PDF post-parse: dedup hit, response in <1s, immediate navigation to dashboard
- [ ] Re-upload same PDF mid-parse: dedup hit returns existing `document_id` with `status='pending'`, frontend re-attaches
- [ ] Corrupt PDF: server-side parse fails → background catch marks `status='failed'`, frontend surfaces error inline
- [ ] Stuck-pending recovery: manually set a documents row to old pending state via SQL → dashboard mount triggers `/ingest-recover` → document completes
- [ ] Svix signature verification unit test passes with known-good fixture
- [ ] `/piqc-review` passes locally; CI `piqc-discipline.yml` passes
