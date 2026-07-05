---
owner: fable-dev-piqc
feature: deliverable-export-config
status: in-review
started: 2026-07-05
target_pr:
---

# Config-driven export builder — all five deliverables exportable

## Context

`buildDeliverablePdf` is hardwired to `MONITORING_SECTION_ORDER/LABELS`,
`buildDeliverableFilename` hardcodes `monitoring_prep_checklist`, and
`fetchDeliverableExportPacket` only passes through monitoring/siv. That is why
three of the five deliverables (risk_overview, cra_monitoring_focus,
site_training_priorities) ship `exportEnabled:false` — the export path can't
render their sections. This slice makes the portrait-PDF builder config-driven
and enables export for all three (founder decision 2026-07-05: all five
exportable). Fable-frontend-only; no migration, no backend dependency.

## Design

- **New `deliverableExportConfig.ts`** (lib layer, imports only types): a
  `Record<DeliverableArtifactType, {sectionOrder, sectionLabels, filenameSlug,
  headerLabel, disclaimer}>`. Exhaustive-typed → a future artifact type won't
  compile without an export config. Every disclaimer keeps the compliance
  tokens (source-backed · draft · outside PIQC) and never uses approval
  vocabulary; every header label carries "PIQC drafted · … · DRAFT".
- **Generalize `deliverablesExportApi.ts`:** `buildDeliverablePdf(packet)` reads
  the config by `packet.artifact_type` for section order/labels, header label,
  and disclaimer (monitoring output stays byte-identical — its config entry IS
  the existing constants). `buildDeliverableFilename(packet)` reads
  `config.filenameSlug` (monitoring slug unchanged); it now serves siv too, so
  `buildSivDeckFilename` is deleted (single caller). `fetchDeliverableExportPacket`
  passes through any known artifact type (whitelist from the config keys — the
  whitelist-from-labels lesson) instead of degrading all-but-two to monitoring.
  `DELIVERABLE_EXPORT_DISCLAIMER` / `_HEADER_LABEL` stay exported (re-export the
  monitoring config entry — no behavior change for the constants' consumers/tests).
  `downloadDeliverable`: siv still routes to `buildSivDeck` (its own landscape
  builder, untouched); filename for ALL types comes from `buildDeliverableFilename`.
- **Flip `exportEnabled` → true** for risk_overview, cra_monitoring_focus,
  site_training_priorities in `deliverableConfigs.ts`.
- **`DeliverablePanel` export button** copy generalized from hardcoded
  "checklist" to the artifact `noun` (aria-label + tooltip) so a risk-overview
  export button no longer says "checklist".

## Scope (files allowed)

- `plans/fable/deliverable-export-config.md` — this file.
- `src/lib/deliverables/deliverableExportConfig.ts` — NEW.
- `src/lib/deliverables/deliverablesExportApi.ts` — generalize builder/filename/fetch.
- `src/lib/deliverables/__tests__/deliverablesExportApi.test.ts` — extend (new types).
- `src/lib/deliverables/__tests__/deliverableExportConfig.test.ts` — NEW.
- `src/components/deliverables/deliverableConfigs.ts` — flip 3 exportEnabled flags.
- `src/components/deliverables/DeliverablePanel.tsx` — export-button noun.

## Out of scope (files forbidden)

- `src/lib/deliverables/exporters/buildSivDeck.ts` — SIV deck is self-contained
  (own header/disclaimer/section order); it only gains the shared filename fn.
- The selection specs, the migration/RPC layer, the adapter, other modes.
- `src/types/deliverables/index.ts` — section constants already exist; the
  export config references them (no type change needed).

## Architecture layers touched

- [ ] migration / RPC / adapter / context
- [x] component (deliverableConfigs flags, DeliverablePanel button copy)
- [x] lib (export config + builder generalization)
- [x] test (config invariants + multi-type builder coverage)

## Mock data plan

None.

## Approved-by

- No non-Fable codeowner: every file is under `src/lib/deliverables/` or
  `src/components/deliverables/` (both `@fable-dev-piqc`). No migration, no
  2-reviewer shared-infra file.

## Verification

- [x] typecheck / build green; the 46 existing export tests pass UNCHANGED
  (monitoring output byte-identical — verified the re-exported constants equal
  the former hardcoded strings); +26 new tests (config invariants + multi-type);
  full suite 19 failed / 1032 passed — the same pre-existing baseline (one own
  stale assertion updated for the new all-exportable behavior).
- [x] Adversarial review (4 verified lenses): behavior-preservation, multi-type
  correctness, and discipline lenses clean; 1 confirmed low finding — a stale
  JSDoc on Props.exportEnabled still said "risk/CRA export-disabled". Fixed.
- [ ] Manual (enterprise sub, Sponsor → Protocol Intelligence): each of the 5
  chips now shows an Export button; exporting risk/CRA/site-training produces a
  DRAFT PDF with that type's sections, header label, disclaimer, filename slug,
  and traceability appendix; monitoring + SIV exports unchanged.
- [ ] `/piqc-review` clean (no `any`, semantic tokens, pure — no supabase in the
  builder path beyond the existing fetch).

## Decisions encoded

1. **Config over hardcode.** The export builder becomes a config consumer like
   the panel — one exhaustive map keyed by artifact type; adding a 6th type
   forces its export config too.
2. **All five exportable** (founder call). Every deliverable is a draft document
   that can be handed onward, each with the DRAFT watermark + disclaimer.
3. **SIV deck stays its own builder.** Landscape teaching deck ≠ portrait
   checklist; only the filename helper is shared.
4. **Monitoring output frozen.** Its config entry reproduces the existing
   constants exactly; the existing test suite passes unchanged as the proof.
