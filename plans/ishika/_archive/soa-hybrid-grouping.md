---
owner: ish-dev-piqc
feature: SoA hybrid extraction (deterministic read + LLM grouping)
status: merged
merged: 2026-06-12
started: 2026-06-11
target_pr: #311
approved_by: "@rv61"   # supabase/functions/_shared/* is Roger's area
---

# SoA hybrid extraction — deterministic column read + LLM grouping

## Context
Visit Prep must turn the Schedule-of-Assessments grid into an accurate, ordered visit list for ANY protocol. Validated empirically on 5 protocols (Phase 1/2/3, 4 sponsors): a deterministic reader alone is complete but mis-groups (over-segments hierarchical schedules, double-counts duplicate tables, reads TOC tables as SoAs); an LLM alone collapses/under-reads long schedules. The hybrid — deterministic reads every column + mark (self-consistency), then ONE GPT-4o call groups the *column-header list* into visits (drop non-visits, collapse intra-day timepoints, dedup) — was correct on all 5. The LLM never sees cells, so it cannot under-read or invent; deterministic owns completeness, the LLM owns the grouping judgment.

Full design, data flow, and costs: `~/.claude/plans/ok-so-now-lets-wiggly-comet.md` (approved).

## Scope (files allowed)
- `supabase/functions/_shared/soaGridParser.ts` — RawColumn extraction (export), `assembleVisitsFromGrouping`, broad glyph set, structural band detection, self-consistency.
- `supabase/functions/_shared/ingestPipeline.ts` — `groupSoaColumnsViaLlm` (reuse `openaiChatCompletion` + `withRetry`, model gpt-4o) + wire into `processIngestCompletion`'s SoA block + `extraction_method` + fallback.
- `supabase/functions/_shared/soaColumnCount.ts` — independent count cross-check (reuse for flagging).
- `supabase/functions/_shared/__tests__/soaGridParser.test.ts` (+ fixtures) — golden tests for the 5 protocols.
- `src/types/visit-execution/index.ts` — extend `VisitExtractionMethod` (`grid_grouped` / `grid_ungrouped`).
- `src/lib/visit-execution/visitExecutionApi.ts` — map the new method values.
- `src/components/dashboard/visit-execution/CoverageBanner.tsx` — banner copy for the new states.
- `plans/ishika/soa-hybrid-grouping.md`

## Out of scope (must NOT touch)
- Any Site / Audit mode files; other SOTR adapters; `supabase/migrations/*` (no schema change — `extraction_method` column already exists); auth/billing/entitlements.
- `documents/*.pdf` and root `*.mjs` scaffolding (never committed; PHI + throwaway).

## Architecture layers touched
adapter (soaGridParser), pipeline/edge-fn (ingestPipeline), type mirror (src/types), api mapper, component (CoverageBanner), test. No migration, no RPC change.

## Mock data plan
None.

## Approved-by
`@rv61` (Roger) — `supabase/functions/_shared/*` ownership.

## Verification
- Golden vitest over the 5 cached protocol parses: RawColumn extraction (deterministic, stable) + `assembleVisitsFromGrouping` against a MOCKED grouping → no live LLM in CI. Expected: ASN008=8, BLKR201≈12, PledOx≈20–21, RVW101 (TOC dropped), CLR≈12.
- Live smoke (gated, not CI): re-run harness on the 5; confirm counts.
- E2E: redeploy edge fns → re-ingest each → Visit Prep shows grouped, ordered visits + citations; force LLM failure → `grid_ungrouped` fallback + banner flag.
