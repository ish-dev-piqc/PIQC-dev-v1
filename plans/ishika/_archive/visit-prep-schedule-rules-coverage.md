---
owner: ish-dev-piqc
feature: visit-prep-schedule-rules-coverage
status: merged
merged: 2026-06-03
started: 2026-06-02
target_pr: #247
---

# Visit Prep — schedule rules (#3) + completeness coverage (#4)

## Context

Builds on #1 (idempotent prune) + #2 (name normalization). Adds the remaining Visit-Prep
extraction-quality fixes from the approved plan (`~/.claude/plans/ok-so-now-lets-wiggly-comet.md`),
all on one branch per the dev's request:

- **#3a** flag visits whose `study_day` contradicts their name (EOT@day 0/14) as per-visit review signals.
- **#3b** expand aggregate rows (`Treatment Visits 2,3,4,5,6 (Weeks 2,4,6,8,10)`) into individual visits
  by parsing the STATED week pairing — so visits 5,6,9-12 that only exist inside an aggregate become real
  rows. Flag (not drop) when the pairing can't be parsed cleanly.
- **#4** a protocol-level completeness check: deterministic sequence reconciliation (gaps in a numbered
  series) + unexpandable aggregates + an adversarial LLM pass → a `protocol_visit_coverage` row, surfaced
  in a Visit-Prep coverage banner. Review-only — never auto-creates visits.

## Scope (files allowed)

- supabase/functions/_shared/visitScheduleRules.ts
- supabase/functions/_shared/__tests__/visitScheduleRules.test.ts
- supabase/functions/_shared/ingestPipeline.ts
- supabase/migrations/20260626000000_protocol_visit_coverage.sql
- src/types/visit-execution/index.ts
- src/lib/visit-execution/visitExecutionApi.ts
- src/components/dashboard/visit-execution/CoverageBanner.tsx
- src/components/dashboard/visit-execution/VisitExecutionTab.tsx

## Out of scope (files forbidden)

- The persist RPC (`visit_execution_persist_parsed_workspace`) — NOT restated: the #1 prune already
  cascade-deletes a corrected visit's stale signals, so no stale-clear extension is needed.
- The workspace RPC (`visit_execution_get_workspace`) — coverage is a separate `get_coverage` RPC, so
  the big workspace RPC is untouched.

## Architecture layers touched

- [x] migration (`protocol_visit_coverage` table + RLS)
- [x] RPC (`visit_execution_get_coverage`; ingest writes coverage)
- [ ] adapter
- [ ] context
- [x] component (`CoverageBanner`, `VisitExecutionTab`)
- [x] test

**DB schema change → TS type mirror:** YES — `VisitCoverage` added to `src/types/visit-execution/index.ts`
(the new coverage RPC's shape).

## Mock data plan

none. (Coverage fetch returns null in mock mode; banner hides.)

## Approved-by

- @rv61 (Roger) — `supabase/functions/_shared/` + `supabase/migrations/` (ingest + coverage table/RPC).
- `src/lib/visit-execution`, `src/types/visit-execution`, `src/components/dashboard/visit-execution` — Ishika owns directly.

## Verification

- `npm test` — `visitScheduleRules` (12: implausible-day, aggregate expand/flag, sequence gaps incl. the 5/6 case) + `visitNameNormalize` parity green; `npm run typecheck` clean.
- Deploy `ingest ingest-recover ingest-status` + apply the migration; re-ingest PP06489 and assert: visits 5,6,9-12 now exist as individual rows; the EOT@0/14 templates carry an `implausible_study_day` signal; the coverage banner shows expected/found + any gaps.
- Idempotency: re-ingest twice → stable counts.
