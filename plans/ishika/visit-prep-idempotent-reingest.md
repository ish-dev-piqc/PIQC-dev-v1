---
owner: ish-dev-piqc
feature: visit-prep-idempotent-reingest
status: active
started: 2026-06-02
target_pr:
---

# Visit Prep — make visit-template ingest idempotent (prune stale on re-ingest)

## Context

Re-ingesting a protocol document accumulates duplicate visit templates. The step-5 upsert in
`ingestPipeline.ts` keys on `(protocol_id, visit_name, study_day)` and never removes stale rows, and
Reducto's LLM extraction is non-deterministic across runs (the same visit comes back as
`"Treatment Visit 1"` / `"…(Cycle 1 Day 1)"` / `"…(Week 0)"`). Verified on dev: protocol PP06489 was
ingested 6× in a 2-minute window and now has **36 templates for ~12–15 real visits**. Fix: after
upserting the current batch, **prune** this document's templates whose `(visit_name, study_day)` is no
longer in the extraction — prune-stale (not delete-all) so surviving visits keep their IDs +
`visit_requirements` + human edits (the fingerprint-based edit-preservation path).

## Scope (files allowed)

- supabase/functions/_shared/ingestPipeline.ts
- supabase/functions/_shared/visitTemplateDedup.ts
- supabase/functions/_shared/__tests__/visitTemplateDedup.test.ts

## Out of scope (files forbidden)

- Visit-name normalization (#2) and aggregate/garbled-row rejection (#3) — designed separately; not in this PR.
- supabase/migrations/ — no schema change (the table + unique constraint already exist).
- Any frontend / src.

## Architecture layers touched

- [ ] migration
- [x] RPC / ingest (`supabase/functions/_shared/`)
- [ ] adapter
- [ ] context
- [ ] component
- [x] test

**DB schema change → TS type mirror:** N/A — no schema change.

## Mock data plan

none.

## Approved-by

- @rv61 (Roger) — `supabase/functions/_shared/` (ingest pipeline). Adds a prune step + a pure `staleTemplateIds` helper; no schema/RPC-signature change.

## Verification

- [ ] `npx vitest run supabase/functions/_shared/__tests__/visitTemplateDedup.test.ts` green (incl. new `staleTemplateIds` cases).
- [ ] Re-ingesting a doc whose extraction renamed a visit replaces the old row (no accumulation); a visit that persists keeps its requirements/edits.
- [ ] Prune is gated on a non-empty new batch (a zero-visit re-ingest must NOT wipe existing templates).
- [ ] Prune is scoped to `source_document_id` (multi-doc protocols untouched).
