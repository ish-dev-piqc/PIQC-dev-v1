---
owner: sixonelabs-piqc
feature: sot301-cycle-grouping
status: merged
started: 2026-07-06
target_pr: "#460"
---

# SOT-301 — cycle-aware visit grouping in the SOTR adapter

## Context

Bug-hunt run FB-af47638 confirmed (blind-verified, HIGH clinical): `normalizeVisitName` strips
cycle parentheticals, so visits differing only by cycle ("Visit 2 (Cycle 1 Day 8)" vs "(Cycle 2
Day 8)") collapse into one grouping key in `dedupeVisitArray` — pairing evidence with the wrong
cycle's visit. The #458 pass correctly flagged (not force-fixed) it: the pure normalizer can't
distinguish a restatement from a discriminator. The adapter can — it sees the whole group.

## Scope (files allowed)

- src/lib/sotr/sourceEvidenceAdapter.ts
- supabase/functions/_shared/sourceEvidenceAdapter.ts   # Deno mirror — parity kept
- src/lib/sotr/__tests__/sourceEvidenceAdapter.test.ts
- src/lib/sotr/__tests__/visitNameNormalize.test.ts

## Out of scope (files forbidden)

- src/lib/sotr/visitNameNormalize.ts (stays byte-identical to Deno copy — restatement contract)
- website/, supabase/migrations/

## Architecture layers touched

- [x] adapter (pure function — grouping logic only)
- [x] test

## Mock data plan

none

## Approved-by

- @ish-dev-piqc — src/lib/sotr/** (SOTR owner; also owns the "is study-cycle the right grain"
  product confirmation from the FB report)
- @rv61 — supabase/functions/_shared/** (Deno mirror)

## Verification

- [x] Rule: group by normalized name (unchanged); split any group spanning ≥2 distinct cycle
      numbers parsed from RAW names; cycle-less entries only merge when ≤1 distinct cycle
      (preserves the legitimate "(Cycle 1 Day 1)" restatement collapse; never guesses a bare
      name onto a cycle — under-collapse over over-collapse).
- [x] tsc --noEmit clean
- [x] vitest 99 files / 1334 passed, 0 skipped (the FB-af47638 describe.skip converted to a
      passing division-of-labor test; 4 new SOT-301 adapter tests; drift-check proves the two
      adapter copies stay in lockstep)
