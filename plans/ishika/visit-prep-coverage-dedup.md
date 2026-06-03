---
owner: ish-dev-piqc
feature: Visit Prep — coverage dedup (#4) + upload finalization fix
status: active
started: 2026-06-03
target_pr:
approved_by: rv61 (supabase/_shared ingest pipeline)
---

# Visit Prep — coverage completeness dedup (#4 follow-up)

## Context

The #4 completeness coverage (merged) writes `protocol_visit_coverage.missing` by
concatenating three detectors: deterministic sequence reconciliation, unexpandable
aggregate flags, and the LLM adversarial pass. When two detectors flag the **same**
missing visit (the common case — sequence + LLM both catch "Treatment Visit 5"), the
visit appears **twice** in `missing`, and `expected_count = found + missing.length`
double-counts it. Live example (PP06489 POLAR-A): banner reads "12 of 16 expected — 4
to review" listing Visit 5 and 6 each twice, when the truth is "14 expected — 2 to
review."

## Scope (files allowed)

- `supabase/functions/_shared/ingestPipeline.ts` — dedup the merged `missing` list by
  normalized label before the `protocol_visit_coverage` upsert (~line 2366), so
  `expected_count` and the list reflect unique missing visits.
- `src/components/dashboard/KnowledgeBase.tsx` — `UploadForm` calls `onSuccess` only when
  the parse reaches `ready` (not at parse-start), so consumers that close on `onSuccess`
  (`ProtocolUploadModal`) don't unmount the form and kill the poll loop mid-parse.
- `src/components/dashboard/Dashboard.tsx` — wire `ingest-recover` on dashboard mount
  (the function was built for this but never called), finalizing any docs stranded in
  `pending` (tab/modal closed mid-parse). Both files are on the CI supabase-debt allowlist.

## Out of scope (files forbidden)

- `supabase/functions/_shared/visitScheduleRules.ts` (detectors are correct individually)
- `supabase/migrations/*` (no schema change — logic only)
- `src/types/**`, `src/lib/**` (no type/API change — IngestResponse shape unchanged)
- `ProtocolUploadModal.tsx` / `ProtocolOnboarding.tsx` (fix is centralized in `UploadForm`)

## Architecture layers touched

- Pipeline (ingest completion write path). No migration, no RPC, no adapter, no component.

## Mock data plan

None.

## Approved-by

- `rv61` (Roger) — owns `supabase/`; this touches the shared ingest pipeline only in
  the coverage-write block.

## Verification

- Dedup keeps first occurrence per normalized label; sequence gaps lead so the precise
  deterministic reason wins over LLM prose. Aggregate flags (label = full gap_text) are
  distinct and unaffected.
- Re-ingest a protocol with a known gap (PP06489) → coverage row shows each missing
  visit once; `expected_count = found_count + unique_missing`.
- Idempotent: re-ingest twice → stable coverage row.
