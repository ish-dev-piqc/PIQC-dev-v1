---
owner: fable-dev-piqc
feature: prohibited-meds-extraction
status: merged
merged: 2026-07-04
started: 2026-07-03
target_pr: #412
---

# Prohibited-medications extraction — Reducto schema → SOTR facts → checklist upgrade

## Context

Closes the top entry of the handover's data-gap ledger: prohibited /
concomitant-medication restrictions are absent from
`CLINICAL_EXTRACT_SCHEMA`, so the monitoring checklist's
`exclusion_prohibited_med_review` section ships a permanent coverage-gap
framing block. This slice adds the extraction field, maps it to
`field_type='prohibited_med'` SOTR rows (evidence-linked like every other
fact), and upgrades the checklist section to consume the facts — the gap
block becomes the zero-rows fallback. One vertical slice: extraction →
facts → deliverable.

## Design

### Extraction (Reducto schema + both adapter copies)

- `CLINICAL_EXTRACT_SCHEMA` gains `prohibited_medications: string[]` —
  verbatim medication/class entries from concomitant-medication and
  washout sections; empty when the protocol lists none. Field style
  mirrors `key_exclusion_criteria` exactly.
- Schema-key → field_type mapping `prohibited_medications` →
  `'prohibited_med'` added to BOTH adapter copies —
  `src/lib/sotr/sourceEvidenceAdapter.ts` AND
  `supabase/functions/_shared/sourceEvidenceAdapter.ts` (the Deno
  duplicate; `adapterDuplicationDriftCheck.test.ts` enforces parity).
  Rows carry field_path `prohibited_medications[i]`, citations flow
  through the normal evidence chain — no new plumbing.

### Checklist upgrade (spec + migration)

- `selection/monitoringChecklist.ts` section 2: when `prohibited_med`
  facts exist → one `checklist_item` per medication ("Confirm absence of
  prohibited medication: <med> — cross-check the participant's
  medication history.") with evidence + confidence; the coverage-gap
  framing block emits ONLY when zero rows. Exclusion-criteria cards
  unchanged. Tests updated (spec-parity discipline).
- New migration `CREATE OR REPLACE deliverable_generate` porting the
  updated section 2; checklist branch otherwise byte-preserved; the
  risk_overview branch untouched.

## Scope (files allowed)

- `plans/fable/prohibited-meds-extraction.md` — this file.
- `supabase/functions/_shared/ingestPipeline.ts` — schema field only.
- `supabase/functions/_shared/sourceEvidenceAdapter.ts` — mapping entry.
- `supabase/functions/_shared/sotrTypes.ts` — only if the mirror needs it.
- `src/lib/sotr/sourceEvidenceAdapter.ts` — mapping entry.
- `src/lib/sotr/__tests__/` — mapping + drift-check coverage.
- `src/components/sotr/WorksheetItemsList.tsx` — ONE line: the
  FIELD_TYPE_LABELS entry for 'prohibited_med' (adversarial review found
  the group header rendering the raw key on the exact verification
  surface). No other SOTR UI changes.
- `src/lib/deliverables/selection/monitoringChecklist.ts` + its test —
  section-2 spec upgrade (and the reciprocal KEEP IN SYNC notes).
- `supabase/migrations/*_deliverable_prohibited_meds.sql` — new migration.

## Out of scope (files forbidden)

- `src/lib/deliverables/selection/riskOverview.ts` — prohibited meds in
  the risk lens is follow-up debt, not this slice.
- All deliverable UI components — new facts render through the existing
  section with zero UI changes.
- SoA grid parsing, embeddings, visit-execution persistence — no other
  `ingestPipeline.ts` regions beyond the schema constant.
- `src/lib/{site,audit}/`, VEW files, SOTR review UI.
- Merged migrations.

## Architecture layers touched

- [x] migration (1 new: deliverable_generate v3)
- [x] RPC (section-2 dispatch branch updated)
- [x] adapter (schema-key mapping, browser + Deno copies)
- [ ] context
- [ ] component
- [x] test (adapter mapping, drift check, checklist spec)

## Mock data plan

None.

## Approved-by

- Roger (`@rv61`) — `supabase/functions/*`, `supabase/migrations/*`.
  NOTE for Roger: this changes the Reducto Extract schema — after merge,
  `functions deploy ingest` is required and ALREADY-INGESTED protocols
  will not gain prohibited_med rows until re-ingest (documented in
  Verification).
- Ishika (`@ish-dev-piqc`) — `src/lib/sotr/sourceEvidenceAdapter.ts` +
  its tests (one mapping entry + coverage), and the one-line
  FIELD_TYPE_LABELS addition in `src/components/sotr/WorksheetItemsList.tsx`.

## Verification

- [x] `npm run typecheck`, `npm run build`, `npm test` clean; adapter
  drift-check green (72/72 sotr); checklist spec tests updated + green
  (193 deliverables, up from 187); zero new full-suite failures vs the
  fork-point baseline (same-environment comparison).
- [ ] Manual after `functions deploy ingest` + `db push` + re-ingest of a
  demo protocol: SOTR review list shows prohibited_med items with
  citations → regenerate monitoring checklist → section 2 lists the
  medications with evidence chips; gap block gone; a protocol with no
  restrictions still shows the gap-block fallback.
- [x] `piqc-review` clean.

## Decisions encoded

1. **Verbatim extraction, no normalization.** Medication names/classes
   land as written in the protocol; deterministic prose wraps them.
   Drug-name normalization is out (invented mappings violate the
   evidence doctrine).
2. **Gap block becomes fallback, never disappears silently** — a
   zero-rows protocol still tells the CRA to verify manually
   (completeness doctrine: absence of extraction ≠ absence of
   restrictions).
3. **Risk lens untouched** this slice (follow-up debt with a named
   trigger: CRA Monitoring Focus build).
4. **Re-ingest is the activation path** for existing protocols — no
   backfill job (the idempotent re-ingest pipeline already handles it).
