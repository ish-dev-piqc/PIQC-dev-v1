---
owner: ish-dev-piqc
feature: footnote-symbols-count-noise
status: in-review
started: 2026-07-03
target_pr:
---

# Visit Prep — polish bundle: footnote symbol markers + reconcile count noise (Slice C)

## Context

Two small, independent wins from the Visit Prep review:

1. **`parseStatedCohortCount` over-fires.** Its regex allows up to 3 arbitrary words between the number and the cohort noun and doesn't guard the preceding context, so "…Part 1 … cohorts" style prose is read as a stated count of 1 → the reconcile then flags a bogus "prose states 1; extraction found 3" on a correct 3-arm design. Tighten it (shrink the intervening-word window + exclude a sectioning-word anchor like "Part/Table/Phase N") so a real count still reads but stray figures don't.
2. **Footnotes drawer misses symbol legends.** `get_protocol_soa_footnotes` only matches lettered legends (`content ~ '(^|\n)\s*[a-z]\.\s'`). Symbol-style footnotes (`* † ‡ §`) and numbered ones don't surface. Broaden the marker pattern. This is a **read RPC** → it works on **existing** data immediately (no re-ingest).

## Scope (files allowed)

- supabase/functions/_shared/cohortExtraction.ts — `parseStatedCohortCount` only (tighten the regex).
- supabase/functions/_shared/__tests__/cohortExtraction.test.ts — new `parseStatedCohortCount` false-fire cases.
- supabase/migrations/20260709000000_soa_footnotes_symbol_markers.sql (NEW) — `CREATE OR REPLACE get_protocol_soa_footnotes` with a broadened marker pattern.

## Out of scope

- `reconcileCohorts` / `parseStudyCohorts` / cohort binding (Slice B, PR #400) — different functions in the same file; non-adjacent, 3-way-merge clean.
- Footnote → procedure structuring (Slice D, deferred). No change to the drawer UI or the read shape.
- The persist RPC (Slice A, PR #399).

## Architecture layers

- [x] parser/extraction (`cohortExtraction.ts` — pure, vitest-tested)
- [x] migration (RPC) — `supabase/migrations/` (read RPC, `CREATE OR REPLACE`, append-only)
- [ ] context / component
- [x] test (vitest for `parseStatedCohortCount`; the RPC regex is Postgres — validated by apply + no-regression on existing data + a pattern proxy)

**DB schema change → TS type mirror:** N/A — the RPC's return shape (`{page, section, content}`) is unchanged; only the WHERE marker pattern widens. No TS type consumes it structurally.

## Approved-by

- @rv61 (Roger) — `cohortExtraction.ts` + `supabase/migrations/`.

## Fix

1. **`parseStatedCohortCount`** — shrink the intervening-word window `{0,3}` → `{0,1}` and add a negative lookbehind so a number immediately preceded by a sectioning word (`part|parts|table|figure|section|phase|day|week|visit|arm|group|cohort` + space) is not read as a cohort count. Keeps every accepted case ("6 cohorts", "six dose cohorts", "6 ascending-dose cohorts", "three treatment arms"); drops "in Part 1 the treatment arms…" and multi-word-gap stray figures.
2. **`get_protocol_soa_footnotes`** — broaden the marker regex from `(^|\n)\s*[a-z]\.\s` to also accept numbered (`1.` / `1)`) and symbol (`* † ‡ § ¶`) legends: `(^|\n)\s*([a-z]\.|[0-9]{1,2}[.)]|[*†‡§¶]+)\s`. Superset of the lettered pattern → no regression for lettered protocols; symbol legends chunk less cleanly (accepted: a slightly messier drawer, per the review).

## Verification

- `npx vitest run …/cohortExtraction.test.ts` green, incl. new false-fire cases (Part-N prose → null; multi-word-gap → null; accepted counts unchanged).
- `supabase db push` applies the footnotes migration cleanly (validates the regex).
- **No regression:** BLKR201's lettered footnotes still return the same count post-migration (read-only check).
- Symbol-legend matching validated by pattern construction (superset) + a regex proxy on sample strings — a live symbol-footnote protocol (POLAR-M) is no longer in the DB, so live symbol verification is deferred to the next such ingest.
- `npm run typecheck` clean; `/piqc-review` green.
