---
owner: fable-dev-piqc
feature: siv-package
status: in-review
started: 2026-07-05
target_pr:
---

# SIV Knowledge Transfer Package — fourth artifact_type + deck export

## Context

Handover Phase 4 / §6.4's first implementation target: a
sponsor-reviewable, protocol-derived **SIV knowledge-transfer package**
— not a generic deck, a protocol-specific outline whose every content
block is evidence-linked and human-reviewable before anything is
presented. Fourth lens on the engine (zero new tables) plus the two
machines this slice genuinely adds: a **`speaker_note` block type**
(teaching register — the "distinct rendering" revisit trigger named in
Phase 1 Decision 1 has fired) and **per-artifact-type export dispatch**
with a landscape **deck builder** (`buildSivDeck`, existing jsPDF, no
new dependency — pptx stays deferred per the approved roadmap).

## Design

### Sections (`SivSectionKey`, teaching order)

`study_overview` (design/phase/dosing facts + framing) →
`participant_journey` (visit schedule walk: name/day/window facts) →
`eligibility_emphasis` (complex criteria + ALL prohibited meds — the
SIV must teach the medication restrictions) → `endpoint_critical`
(primary endpoints; why they matter to first-patient quality) →
`windows_and_timing` (narrow windows + exact-day visits) →
`vendor_lab_workflows` (keyword taxonomy; KEEP IN SYNC) →
`safety_expectations` (framing: reporting expectations teaching notes)
→ `amendment_changes` (fact card / confirm-version fallback) →
`before_first_patient` (framing summary: the "what must be understood"
close, assembled from non-zero counts only).

Each section: `section_intro` (the slide's framing) + fact
`checklist_item` blocks (the slide's evidence-backed bullets) + ONE
`speaker_note` block (derived_operational_framing, teaching register:
"Teaching point: … Likely site question: … Confirm with the sponsor
before presenting." — deterministic templates, no LLM, explicitly
carrying the sponsor-confirmation warning the handover requires).
Prose-register rule continues: SIV wording never byte-duplicates the
other three lenses.

### block_type widening

- TS: `DeliverableBlockType` += `'speaker_note'`; adapter `BLOCK_TYPES`
  += entry (hand-listed — intake caught it this time; a derivation map
  would be over-engineering for a 4-value union, but the adapter
  regression test now iterates ALL block types).
- SQL: the inline CHECK on `protocol_deliverable_blocks.block_type` is
  dropped by dynamically-resolved name (pg_constraint lookup in a DO
  block) and re-added as an explicitly named constraint with the 4
  values — stable name for the next widening.
- Rendering: `DeliverableBlockRow` gives `speaker_note` a quiet
  distinct treatment (Presentation icon + "Speaker note" label line,
  same review machinery — notes are blocks: editable, rejectable,
  reviewed like everything else).

### Export dispatch + deck builder

- `downloadDeliverable` dispatches on `packet.artifact_type`:
  `monitoring_prep_checklist` → existing `buildDeliverablePdf`
  (byte-identical behavior); `siv_package` → `buildSivDeck`; risk/CRA
  remain export-disabled (their chips unchanged).
- `src/lib/deliverables/exporters/buildSivDeck.ts` — PURE, landscape
  A4 jsPDF: title slide (protocol code/title/version, DRAFT-heavy),
  one slide per non-empty section (heading + fact bullets with
  confidence marks), speaker notes rendered in a visually separate
  band on each slide, disclaimer footer + page X/Y, traceability
  appendix (section/page per fact), sponsor-name-free. Filename
  `<code>_siv_package_draft_<date>.pdf`.

### Migration (`20260713000000_deliverable_siv_package.sql`)

ALTER TYPE ADD VALUE `'siv_package'`; block_type CHECK widen (above);
CREATE OR REPLACE `deliverable_generate` v5: SIV branch ported from the
TS spec; checklist/risk/CRA branches byte-preserved from v4; title
'SIV Knowledge Transfer Package — Draft'; COMMENT + GRANT re-issued.
Same enum-in-transaction hazard note (function bodies store as text).

## Scope (files allowed)

- `plans/fable/siv-package.md` — this file.
- `src/types/deliverables/index.ts` — enum, labels, block type, SIV
  section vocabulary.
- `src/lib/deliverables/selection/sivPackage.ts` (+ test, new).
- `src/lib/deliverables/exporters/buildSivDeck.ts` (+ test, new dir).
- `src/lib/deliverables/deliverablesExportApi.ts` — artifact-type
  dispatch in downloadDeliverable (checklist path byte-preserved).
- `src/lib/deliverables/deliverablesAdapter.ts` + adapter test —
  BLOCK_TYPES entry + all-block-types regression.
- `src/lib/deliverables/__tests__/deliverablesExportApi.test.ts` —
  dispatch cases.
- `src/components/deliverables/DeliverableBlockRow.tsx` —
  speaker_note visual treatment only.
- `src/components/dashboard/sponsor/deliverables/ProtocolIntelligenceTab.tsx`
  + `DeliverablePanel.tsx` — fourth chip config + copy-map entry
  (exhaustive-map drill, known since #414).
- `supabase/migrations/*_deliverable_siv_package.sql` (new).

## Out of scope (files forbidden)

- Other selection specs (`monitoringChecklist` / `riskOverview` /
  `craMonitoringFocus`) — read-only KEEP IN SYNC sources.
- `buildDeliverablePdf` internals — the checklist export must remain
  byte-identical; dispatch wraps, never edits.
- `src/lib/actions/**`, `src/components/actions/**` — Action Layer
  untouched (a future `siv_ready` card is follow-up debt).
- KnowledgeTransferTopic table — deferred; the SIV outline's sections
  ARE the topic layer until a second KT package kind exists (named
  debt, trigger: coordinator-onboarding package).
- pptx / new dependencies; modes, contexts, entitlements; ingest;
  merged migrations.

## Architecture layers touched

- [x] migration (1 new: enum + CHECK widen + generate v5)
- [x] RPC (SIV dispatch branch)
- [x] adapter (BLOCK_TYPES entry + regression)
- [ ] context
- [x] component (row treatment, chip + copy config)
- [x] test (SIV spec, deck builder, dispatch, adapter)

## Mock data plan

None.

## Approved-by

- Roger (`@rv61`) — `supabase/migrations/*`. Post-merge note: this
  extends the ACTIVATION.md queue to seven migrations.

## Verification

- [x] typecheck / build green; new SIV spec (21) + deck (9) + dispatch
  suites green; all prior suites unregressed (283 deliverables total);
  zero new full-suite failures vs baseline.
- [x] Deck builder tests: landscape orientation, one slide per
  non-empty section, speaker-note band present, DRAFT + disclaimer +
  appendix, sponsor-name-free, checklist export byte-unchanged
  (dispatch regression).
- [ ] Manual (post db push): fourth chip → Generate → sections render
  with intro/facts/speaker-note blocks (distinct treatment) → review
  machinery works on speaker notes → Export produces the landscape
  deck → checklist export unchanged.
- [x] Speaker-note prose carries the sponsor-confirmation warning
  (test-asserted on every note); no lens prose duplication
  (two-direction prefix tests); no scores.
- [x] `piqc-review` clean.

## Decisions encoded

1. **`speaker_note` block type now** — the Phase-1 "distinct rendering"
   trigger has fired: the deck renders notes in a separate band, and
   reviewers need to see teaching prose as teaching prose.
2. **Deck = landscape PDF, pptx deferred** (approved-roadmap decision;
   revisit only if a sponsor requires editable slides).
3. **Export dispatch on packet.artifact_type** — no per-panel exporter
   props, no builder registry; a switch with two arms is the honest
   size for two exporters.
4. **KnowledgeTransferTopic table deferred** — sections-as-topics until
   a second KT package kind exists; the conceptual layer lives in the
   spec file's section design, not a premature schema.
5. **Speaker notes are deterministic templates** carrying an explicit
   "confirm with the sponsor before presenting" line — the handover's
   sponsor-confirmation warning is structural, not optional prose.
6. Every speaker note is a reviewable block — same edit/reject/audit
   machinery; no un-reviewable content anywhere in the deck.
