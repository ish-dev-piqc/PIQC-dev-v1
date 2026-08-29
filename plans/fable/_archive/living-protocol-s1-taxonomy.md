---
owner: fable
feature: living-protocol-s1-taxonomy
status: merged
merged: 2026-07-19
started: 2026-07-09
branch: fable/living-protocol
target_pr: #496
approved_by: "@rv61 (supabase/ migration)"
---

# S1 — all-signal notice taxonomy swap

First adoption-candidate slice of the Living Protocol proving ground. One
additive migration turns the notable-rail all-signal: it retires the always-on
`endpoint_sdv` worklist, gates `low_confidence_extraction` to high-stakes
field_types, and adds the first two "protocol vs itself" reading acts —
`cross_document_divergence` (N1) and `unwindowed_visit` (N2).

Grounded against `main` + the awareness-layer v2 spec (`protocol-awareness-layer-v2-spec.md`
§7.6, founder decision recorded 2026-07-08). Built in the `fable/living-protocol`
worktree; **not a merge target** — this packet is a proposal the dev partner can
adopt à la carte for minimum change-control disruption (see the operating model
in `living-protocol-branch-isolation.md` §8).

## Workflow stage

Stage 6 — ambiguity & contradiction detection (notable-rail). No new system of
record; no second extractor. Reads the same in-document fact pool as
`action_cards_sync`; writes only to `protocol_notices` (its own sibling table).

## The change (exact diff)

One append-only migration `CREATE OR REPLACE`s `protocol_notices_sync`
(superseding the body in `20260722000100`), plus the TS/component mirror the
closed `NoticeType` union requires:

1. **Remove `endpoint_sdv`** — the endpoint DECLARE vars, its predicate block,
   and its `v_specs` entry. A one-time `DELETE FROM protocol_notices WHERE
   notice_type = 'endpoint_sdv'` reaps orphaned rows (delete-on-zero only reaps
   types still in `v_specs`; spec §5 mandatory gotcha).
2. **Gate `low_confidence_extraction`** — add `field_type IN ('endpoint',
   'visit', 'inclusion_criterion', 'exclusion_criterion', 'dosing',
   'prohibited_med')` to predicate 4. Keys otherwise unchanged; metadata
   low-confidence (sponsor name, etc.) stops surfacing as noise.
3. **Add N1 `cross_document_divergence`** — same `field_path` extracted from ≥2
   of this protocol's documents with disagreeing normalized values. v1
   allowlist: `protocol_number`, `protocol_title`, `dosing_regimen` (scalar,
   clearly protocol facts). `protocol_version`/`is_amendment`/`amendment_summary`
   excluded — expected to differ between base & amendment. Evidence ordered
   base-ish first (`documents.created_at`), both sides cited.
4. **Add N2 `unwindowed_visit`** — this protocol states a window for ≥1 visit
   AND leaves ≥1 high-confidence visit windowless. EXISTS guard means uniform
   omission never fires. Absence claim gated to `confidence_state = 'high'`.

Rail after S1 (5 families, none always-on, severity order):
`cross_document_divergence` (1) · `tight_visit_window` (2) ·
`amendment_in_force` (3) · `unwindowed_visit` (4) · `low_confidence_extraction`
(5, gated).

## Scope

- supabase/migrations/20260723000000_protocol_notices_all_signal_taxonomy.sql
- src/types/actions/index.ts
- src/components/actions/NoticeCard.tsx
- src/components/actions/__tests__/NoticeCard.test.tsx

## Out of scope

- supabase/migrations/20260722000000_protocol_notices.sql
- supabase/migrations/20260722000100_protocol_notices_lowconf_wording.sql
- src/lib/actions/actionsAdapter.ts
- src/lib/sotr/sourceEvidenceAdapter.ts
- supabase/functions/_shared/ingestPipeline.ts

## What each file does

- `20260723...all_signal_taxonomy.sql` — NEW migration. CREATE OR REPLACE the
  sync body + one-time orphan DELETE. Does NOT touch the table, RPCs
  (get/set_status), RLS, or grants from `20260722000000`.
- `src/types/actions/index.ts` — `NoticeType` union: drop `endpoint_sdv`, add
  `cross_document_divergence` + `unwindowed_visit`. Required — the union is
  closed and `NOTICE_ICONS` is an exhaustive `Record<NoticeType, …>`.
- `src/components/actions/NoticeCard.tsx` — `NOTICE_ICONS`: swap `Target` for
  `GitCompareArrows` (N1) + `CalendarOff` (N2). Unknown-type fallback already
  handles server-ahead-of-client.
- `NoticeCard.test.tsx` — add a render case per new type (spec §5).

## Architecture layers touched

migration · component · test. **Adapter untouched** (`adaptNotice` already
passes `notice_type` through unwhitelisted — no TS change needed there).
**Context untouched** (NoticeRail fetch/realtime unchanged). No RPC signature
change (`protocol_notices_get` / `protocol_notice_set_status` stand).

## Mock data plan

None. Real Supabase data on the isolated preview corpus.

## Litmus compliance (the load-bearing rail)

Every predicate reads ONLY facts of the uploaded protocol; no external
"a protocol should have X" norm is ever consulted (spec §7.7):

- N1 cites two passages of the uploaded documents that disagree — protocol vs
  itself.
- N2 cites the uploaded schedule's own inconsistency; the uniform-omission case
  correctly never fires (that is the SoA's design, not a deviation from a norm).
- Every `detail` string names exactly what was read ("in the schedule rows PIQC
  read"), never implying more coverage than performed.

## Verification — precision-gate SQL QA runbook (Roger's lane, apply-time)

Migrations are dev-applied; this runbook is the gate, not a claim that I ran it.
A new predicate ships ONLY after both halves pass, recorded here (spec §7.3):

1. **Clean-control (silence).** On ≥3 clean protocols (no cross-document
   disagreement, uniform windows), confirm `protocol_notices_sync(id)` produces
   ZERO `cross_document_divergence` and ZERO `unwindowed_visit` rows. A wrong
   "PIQC caught something" burns trust faster than silence.
2. **Confirmed-fire (seeded fixture).** On a protocol seeded with (a) a
   `protocol_number` that differs between two documents and (b) one
   high-confidence visit with no window alongside windowed visits, confirm
   exactly one N1 and one N2 notice, each citing the right evidence rows.
3. **Orphan reap.** Confirm no `endpoint_sdv` rows survive the migration
   (`SELECT count(*) FROM protocol_notices WHERE notice_type='endpoint_sdv'` = 0).
4. **Dismiss-preservation.** Dismiss a surviving notice, re-run sync, confirm it
   stays dismissed (ON CONFLICT arm never sets status).
5. **Regression net (my lane, pre-handoff).** `NoticeCard.test.tsx`,
   `notices.adapter.test.ts`, `sourceEvidenceAdapter.test.ts`,
   `adapterDuplicationDriftCheck.test.ts`, `visitNameNormalize.test.ts` green +
   `tsc` clean on the two edited TS files.

## Judging sheet (the portable verdict — becomes the packet's "why")

Per new claim on the judged protocol: cite-check real/wrong, tallied. N1 = does
the flagged field genuinely disagree across the cited documents? N2 = is the
flagged visit genuinely windowless while a sibling genuinely has one? Plus the
clean-control tally (silence on the 3 clean protocols). This manual verdict is
the adoption packet's evidence line — no automated scorer.

## Decision debt (this slice)

- N1 v1 allowlist = 3 scalar fields. Widening to array/version fields deferred
  — index alignment across documents is a false-positive machine (spec §8).
  Trigger: an alignment key (normalized text hash) exists.
- N1 evidence order uses `documents.created_at` as the base-vs-amendment proxy
  (documents carries no amendment flag). The detail never asserts which document
  is authoritative, so the proxy being imperfect is not a correctness risk —
  only the citation order.
- M1 SQL-resident predicates (not M2 ingest-resident). Covers already-parsed
  protocols with zero re-ingest. Trigger: gated semantic dual-reading lands.
- **Cross-document pooling has no "current version" concept** (verify-pass
  finding, 2026-07-09). `unwindowed_visit` and `tight_visit_window` both pool
  `protocol_extracted_items` across every document on the protocol
  (`d.protocol_id = p_protocol_id`) with no supersession/currency filter —
  a superseded base document's stray visit row counts identically to the
  current amendment's. This is a pre-existing repo-wide convention (shared
  unchanged by `tight_visit_window` and `action_cards_sync`), not introduced
  by S1, but N2 is the first predicate whose core promise ("never fires when
  the protocol uniformly omits windows") a stale document's row can silently
  defeat. Real fix needs a documents-currency concept (e.g. supersession
  chain or `is_current`) that doesn't exist in the schema — out of scope
  here. Trigger: the amendment-refresh/versioning roadmap lands, or N2's
  false-positive rate in practice argues for prioritizing it sooner.

## Verify pass (adversarial, Sonnet, 2026-07-09)

Mechanical checks (self): no ALTER/DROP/TRUNCATE outside the documented
orphan DELETE · diff touches exactly the 5 declared Scope files · Reducto /
extract schema / `sourceEvidenceAdapter` untouched · 69/69 tests green · `tsc
--noEmit` clean.

Two independent agents, each blind to the other's pass, adversarially checked
SQL-correctness/spec-fidelity and litmus/honesty-wording. Findings and
resolutions:

- **Fixed — N1 evidence over-citation.** With ≥3 documents sharing a
  diverging `field_path`, the original CTE cited every row sharing that
  path, including ones that agree with each other, diluting the "these
  disagree" claim. Rewrote to cite one representative row per DISTINCT
  normalized value (earliest document first) via a `representative` CTE.
- **Fixed — N2 confidence asymmetry.** The `v_any_window` presence gate had
  no `confidence_state` filter while the fire arm required `'high'` — a
  single noisy low-confidence window misparse anywhere could arm the whole
  notice even when every high-confidence-read visit uniformly omits windows,
  defeating the "never fires on uniform omission" guarantee via noise.
  Added `AND ei.confidence_state = 'high'` to the presence gate, symmetric
  with the fire arm.
- **Fixed — N2 test gap.** The N2 render test asserted headline + data
  attribute but not detail text (unlike its N1 sibling). Added the detail
  assertion.
- **Logged as debt, not fixed — cross-document pooling has no current-version
  concept.** See the decision-debt ledger above; pre-existing repo-wide
  convention, real fix is out of scope for this slice.
- **Not touched, correctly out of scope — pre-existing `low_confidence`
  grammar** ("relying on them" doesn't vary with count=1). Verbatim text
  inherited from `20260722000100`; this slice only added the field_type
  gate and was not asked to touch the wording.
- **No issue found:** `tight_visit_window`/`amendment_in_force`/
  `low_confidence`'s core predicate are byte-identical to the prior
  migration; all 9 field_type/field_path literals verified against real
  ingest-pipeline output; N2's JSONB parse confirmed character-identical to
  the pre-existing narrow-window predicate (copied, not re-derived); zero-
  window case confirmed to never compute a false count; severity 1-5 no
  gaps/dupes matching the founder's §7.6 decision; TS union/Record/tests
  confirmed exhaustive and consistent.

Re-verified after fixes: 69/69 tests green, `tsc --noEmit` clean, no new
DDL introduced.

## Adoption-candidate packet (for the dev partner)

- **What:** one additive migration + closed-union TS mirror + 2 test cases.
- **Guard:** precision-gate runbook above (clean-control + seeded-fire).
- **Why additive:** CREATE OR REPLACE of PIQC's own sync fn + NEW notice_types;
  no ALTER of SOTR/extract tables, no new system of record.
- **What it doesn't touch:** Reducto, extract schema, `sourceEvidenceAdapter`,
  the notices table/RPCs/RLS, any other mode.
- **Rollback:** re-apply `20260722000100` (restores the prior sync body); the
  orphan DELETE is not reversed but endpoint_sdv rows simply regenerate on next
  sync if that body is restored.
- **Judged evidence:** filled after upload-and-judge on the preview corpus.

Relates to `protocol-awareness-layer-v2-spec.md` (§7.6 the decision),
`living-protocol-branch-isolation.md` (§8 operating model),
`living-protocol-roadmap.md` (S-sequence).
