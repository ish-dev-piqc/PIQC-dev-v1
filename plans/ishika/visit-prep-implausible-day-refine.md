---
owner: ish-dev-piqc
feature: visit-prep-implausible-day-refine
status: in-review
started: 2026-06-02
target_pr:
---

# Visit Prep — refine #3a implausible-day to kill false positives

## Context

Post-deploy verification against PP06489 surfaced false positives from #3a (PR #247): the
`< 0.5 × maxStudyDay` rule + the "follow-up" keyword flagged a **legitimate** `EOT Visit @ day 169`
and the `Follow-up` visits @ day 270 as "implausibly early" — but in a study running to day 672, an
end-of-*treatment* visit at month ~6 correctly precedes a long follow-up tail. Refine the rule to be
conservative + absolute: drop "follow-up" as a late marker, and flag a late-named visit only at/near
baseline (`study_day <= 14`) in a study that clearly runs longer (`maxStudyDay >= 60`) — the real
garble we saw (EOT extracted at day 0/14 when the true EOT is day 169).

## Scope (files allowed)

- supabase/functions/_shared/visitScheduleRules.ts
- supabase/functions/_shared/__tests__/visitScheduleRules.test.ts

## Out of scope (files forbidden)

- Everything else.

## Architecture layers touched

- [x] RPC / ingest (pure helper in `supabase/functions/_shared/`)
- [x] test

**DB schema change → TS type mirror:** N/A — no schema change.

## Mock data plan

none.

## Approved-by

- @rv61 (Roger) — `supabase/functions/_shared/`.

## Verification

- `npx vitest run …/visitScheduleRules.test.ts` green (13: still flags EOT@0/14 in a long study; does NOT flag mid-study EOT@169, follow-ups, or a short-study EOT@14).
- Re-run against PP06489's real rows → zero implausible-day flags (EOT@169 + follow-ups correctly silent).
