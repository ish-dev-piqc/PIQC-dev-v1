---
owner: ish-dev-piqc
feature: Visit Prep — fix requirements dropped for parenthetical-named visits
status: merged
merged: 2026-06-03
started: 2026-06-03
target_pr: #259
approved_by: rv61 (supabase/_shared ingest pipeline)
---

# Visit Prep — requirements silently dropped for canonicalized visits

## Context

Regression introduced by the #2 name-normalization fix. `persistVisitExecutionWorkspaces`
maps each schedule entry's procedures to a visit_template by a `name|study_day` key:

- template side (`ingestPipeline.ts:1731`): `${t.visit_name}|${t.study_day}` — but
  `t.visit_name` is now the CANONICALIZED stored name (`"Treatment Visit 1"`).
- lookup side (`ingestPipeline.ts:1754`): `${entry.visit_name}|${studyDay}` — the RAW
  extraction name (`"Treatment Visit 1 (Day 1, Cycle 1)"`).

After #2 these diverge for exactly the visits whose names carry a stripped parenthetical
(the Treatment Visits with `(Day 1, Cycle N)`), so `byKey.get(key)` misses, the loop hits
`if (!tpl) continue`, and every Treatment Visit's procedures are silently dropped → 0
requirements. Milestone visits (Screening/EOT/Assessment/EOS — no parenthetical) still
match, which is why all 56 requirements landed only on them. Confirmed on PP06489 (POLAR-A):
Treatment Visits 1/2/3/4/7/8 = 0 items each.

## Fix (3 layers — fix + prevent + lock)

1. **Single shared key** — `visitMatchKey(name, day)` (canonicalizes its input via the
   existing `canonicalVisitName`) used by BOTH the template side and the lookup side, so
   the two can never drift again. Idempotent: canonical name in → same key; raw name in →
   same key.
2. **Loud, not silent** — replace the bare `if (!tpl) continue` with a guard that records
   any schedule entry that had procedures but matched no template, and `console.error`s a
   `vew_unmatched_visits_with_procedures` summary after the loop. Turns a silent data loss
   into a visible signal for ANY protocol / ANY future cause.
3. **Lock with a test** — assert `visitMatchKey("Treatment Visit 1 (Day 1, Cycle 1)", 1)
   === visitMatchKey("Treatment Visit 1", 1)`. This test would have failed the instant #2
   canonicalized the stored name.

## Scope (files allowed)

- `supabase/functions/_shared/visitTemplateDedup.ts` — add `visitMatchKey` (imports
  `canonicalVisitName` from `visitNameNormalize.ts`); update the "no imports" header note.
- `supabase/functions/_shared/ingestPipeline.ts` — use `visitMatchKey` on both the
  `byKey.set` and lookup sides (~1731 / ~1754); add the unmatched-with-procedures guard.
- `supabase/functions/_shared/__tests__/visitTemplateDedup.test.ts` — parity + basic tests.

## Out of scope

- The persist RPC (`visit_execution_persist_rpc.sql`) — it keys on `visit_template_id`
  supplied by the payload; the bug is purely in how the payload is assembled.
- Name normalization itself (correct; the lookup just needs to apply it too).
- `src/**` — no type/UI change (data-population fix only).

## Architecture layers touched

- Pipeline (ingest completion payload assembly). No migration, no RPC, no type, no component.

## Mock data plan

None.

## Approved-by

- `rv61` (Roger) — `supabase/_shared` ingest pipeline.

## Verification

- `npx vitest run supabase/functions/_shared/__tests__/` — new parity test green; existing
  dedup tests unaffected.
- Re-ingest PP06489 (POLAR-A) after deploy → Treatment Visits 1/2/3/4/7/8 now carry their
  procedures as requirements (TV1 ~5–14 items); milestone visit counts unchanged.
- Existing protocols backfill only on re-ingest (persist runs at ingest time).

## Risks

- **Key drift vs templateKey/upsert** — `visitMatchKey` is for schedule→template matching
  only; the upsert/dedup `templateKey` is separate and operates on already-canonical rows.
  Both canonicalize, so they agree, but they intentionally stay distinct functions.
- **Lowercasing** — `visitMatchKey` lowercases for robustness; harmless because it is used
  symmetrically on both sides (the byKey map is also built with it).
