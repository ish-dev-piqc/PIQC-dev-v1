---
owner: ish-dev-piqc
feature: visit-prep-name-normalization
status: active
started: 2026-06-02
target_pr:
---

# Visit Prep — visit-name normalization (collapse time/cycle variants)

## Context

Reducto emits the same visit under many name strings — the day-1 visit as `Treatment Visit 1` /
`…(Cycle 1 Day 1)` / `…(Day 1, Cycle 1)` / `…(Week 0)`. Dedup keys on the *exact* `(visit_name, study_day)`,
so the variants survive as separate templates (verified: PP06489). This enhances the visit-name normalizer
to strip **pure time/cycle parenthetical restatements**, canonicalizes the **stored** `visit_name` at
ingest, and applies the same normalization on the SOTR/Protocol-tab side so the two surfaces stay
consistent. Fix #2 of the approved plan (`~/.claude/plans/ok-so-now-lets-wiggly-comet.md`). No migration
(Option A) — the existing unique constraint + the merged #1 prune self-heal on re-ingest.

## Scope (files allowed)

- supabase/functions/_shared/visitNameNormalize.ts
- supabase/functions/_shared/ingestPipeline.ts
- supabase/functions/_shared/sourceEvidenceAdapter.ts
- src/lib/sotr/sourceEvidenceAdapter.ts
- supabase/functions/_shared/__tests__/visitNameNormalize.test.ts
- src/lib/sotr/__tests__/sourceEvidenceAdapter.test.ts

## Out of scope (files forbidden)

- supabase/migrations/ — no schema change (Option A).
- src/types/ — no type impact.
- #3a (implausible-day), #3b (aggregate expansion), #4 (coverage) — sequenced as separate PRs.

## Architecture layers touched

- [ ] migration
- [x] RPC / ingest (`supabase/functions/_shared/`)
- [x] adapter (`src/lib/sotr/sourceEvidenceAdapter.ts`)
- [ ] context
- [ ] component
- [x] test

**DB schema change → TS type mirror:** N/A — no schema change, no type impact.

## Mock data plan

none.

## Approved-by

- @rv61 (Roger) — `supabase/functions/_shared/` (ingest pipeline + the Deno SOTR-adapter copy).
- `src/lib/sotr/` — Ishika owns directly.

## Verification

- `npx vitest run supabase/functions/_shared/__tests__/visitNameNormalize.test.ts` + the SOTR parity test green.
- The 4 PP06489 day-1 variants normalize to one key; `(PK substudy)` / `(Unscheduled)` survive un-stripped; the near-miss `Visit 7` vs `Visit 7 (PK substudy)` (same day) stays DISTINCT.
- All 3 normalizer copies produce byte-identical output on the shared corpus.
- `npm run typecheck` clean. After deploy + re-ingest, the day-1 variants collapse to one `Treatment Visit 1` (the #1 prune removes the stale rows).
