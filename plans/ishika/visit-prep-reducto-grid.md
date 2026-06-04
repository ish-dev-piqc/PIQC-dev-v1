---
owner: ish-dev-piqc
feature: Visit Prep — deterministic SoA grid extraction + upload reliability
status: active
started: 2026-06-04
target_pr:
approved_by: rv61 (supabase/ — ingest pipeline, edge fns, migration)
---

# Visit Prep — reliable per-visit population (deterministic SoA grid) + long-PDF upload reliability

Single PR. Full design + the 2-protocol validation evidence live in
`~/.claude/plans/ok-so-now-lets-wiggly-comet.md`. Summary:

## Context
Per-visit checklists collapse because the SoA grid is destroyed before persistence: Reducto's
parse is configured to return an embed-optimized **prose summary** of the SoA table, and a
single non-deterministic LLM `/extract` pass rebuilds `schedule_of_events` from that summary —
collapsing 12 visits to 1–2, with no validation. **Verified (2 protocols, PDF-checked):** Reducto
*also* returns the SoA as an **HTML `<table>` grid** in the table blocks even with
`embedding_optimized:true` — we just discard it. Parsing that grid deterministically yields every
visit with verbatim per-visit procedures, with **zero change to the Ask-tab chunks/embeddings**.

## Scope (files allowed)
- `supabase/functions/_shared/ingestPipeline.ts` — capture Table-block HTML in
  `mapRawChunksToChunkData`/`ChunkData` (no change to `chunk.content`/embeddings); wire the grid
  parse + A-guards + A-fallback gate into `extractClinicalFields`; `temperature:0` + collapse-retry;
  `persistVisitExecutionWorkspaces` byKey collision-safe + unmatched→coverage; staged/parallel
  completion; `kickOffReductoParseAsync` add direct-webhook + metadata.
- NEW `supabase/functions/_shared/soaGridParser.ts` — pure HTML SoA-grid → per-visit procedures.
- NEW `supabase/functions/_shared/soaColumnCount.ts` — pure independent expected-visit-count signal.
- `supabase/functions/_shared/visitTemplateDedup.ts` — `visitMatchKey` (collision support if needed).
- NEW `supabase/functions/_shared/__tests__/soaGridParser.test.ts`, `soaColumnCount.test.ts` (+ byKey).
- `supabase/functions/ingest-status/index.ts` — background/staged completion (`waitUntil`).
- NEW/re-create `supabase/functions/reducto-webhook/index.ts` — direct-webhook finalizer.
- `supabase/functions/ingest-recover/index.ts` — reused by cron.
- NEW migration `supabase/migrations/2026XXXX_visit_coverage_extraction_status.sql` — add
  `extraction_status` + `expected_from_signal` to `protocol_visit_coverage`; `CREATE OR REPLACE
  visit_execution_get_coverage`; (+ pg_cron recover schedule).
- `src/types/visit-execution/index.ts`, `src/lib/visit-execution/visitExecutionApi.ts`,
  `src/components/dashboard/visit-execution/CoverageBanner.tsx` — type mirror + banner copy.
- `src/lib/visit-execution/visitExecutionAdapter.ts`,
  `src/components/dashboard/visit-execution/VisitExecutionTab.tsx` — drive-by: add the
  `source_quote: null` traceability field #257 added to the interface but missed in these
  thin-adapter literals (pre-existing `tsc` regression; keeps this PR's typecheck green).

## Out of scope
- The `/extract` LLM for non-grid fields (title/endpoints/eligibility) — unchanged.
- Ask-tab RAG: `chunk.content`, embeddings, `embedding_optimized` — **unchanged** (verified).
- `#255` (popup fix + dashboard-mount recover) — already merged to main.
- Temp recovery scaffolding (`admin-finalize-doc`/`admin-ingest` fns, deployed) — delete separately.

## Architecture layers
Pipeline (extraction + persist) · RPC (`visit_execution_get_coverage`) · migration · type · component · edge fns (webhook, cron).

## Mock data plan
None.

## Approved-by
- `rv61` (Roger) — owns `supabase/`.

## Verification
- vitest: `soaGridParser` (golden-file PP06489: Screening=14, TV5=13…), `soaColumnCount`, byKey collision.
- E2E: re-ingest PP06489 3× → all 12 visits, exact, stable; force a collapse → coverage banner flags it.
- Long-PDF: upload closes browser mid-parse → webhook/cron still finalizes; completion fits limits.
- Ask tab: chunks/embeddings byte-identical (diff a re-ingest's chunks).
