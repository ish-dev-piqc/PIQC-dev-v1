---
owner: fable-dev-piqc
feature: site-training-priorities
status: active
started: 2026-07-05
target_pr:
---

# Site Training Priorities — the 5th deliverable (reusability capstone)

## Context

Handover §6.1 names "Site Training Priorities" as a Sponsor-Mode operational
intelligence view. This slice adds it as the fifth `artifact_type` on the
existing Protocol Deliverable Engine — **zero new tables, zero new block
types** — proving the roadmap's Phase-6 thesis: a new deliverable kind end
to end over facts already extracted (inclusion/exclusion criteria, the
prohibited_med facts from #412, endpoints, visits + procedures, amendment),
needing no new Reducto pass. A THIRD question over the one fact pool: the
checklist asks "what must be verified", the risk overview "where is execution
fragile", CRA focus "where should limited on-site time go" — this asks **"what
must the site be trained on before activation"**, in an instructional register.

## Design

- **New artifact type** `site_training_priorities`. Mounts as the 5th chip on
  the Sponsor Protocol Intelligence tab. Sponsor-facing (site readiness /
  oversight), so it stays OFF the CRA workspace picker for v1.
- **Seven training-domain sections** (SiteTrainingSectionKey): eligibility &
  screening, visit-schedule & timing, procedure/specimen/vendor, endpoint
  data & source-documentation, safety reporting & oversight, amendment
  retraining, training-logistics questions.
- **Selection ruleset** `selection/siteTrainingPriorities.ts` — pure,
  deterministic, unit-tested; the SQL `deliverable_generate` v7 branch ports it
  byte-for-byte. Reuses the frozen fact-pool + defensive readers + the shared
  vendor/imaging/specimen taxonomy (KEEP IN SYNC comments), same two-emitter
  content-origin discipline as the other four specs. Instructional voice —
  "Train the screening team to…", "Brief coordinators on…", never the
  checklist's "Verify:" or the risk lens's "PIQC flagged" (tests enforce
  distinctive prefixes + no numeric scores).
- **Migration** `20260716000000_...`: `ALTER TYPE deliverable_artifact_type ADD
  VALUE IF NOT EXISTS 'site_training_priorities'` (same enum recipe as risk/cra/
  siv) + `CREATE OR REPLACE FUNCTION deliverable_generate` adding the STP
  ELSIF branch; the four existing branches + the shared match/apply/log stage
  are byte-preserved from 20260715000000 (v6 → v7). Validated with pglast
  (parse_sql + parse_plpgsql) and a difflib byte-diff proving branch
  preservation.
- **Export: DISABLED for v1.** `buildDeliverablePdf` is hardwired to
  MONITORING_SECTION_ORDER; a config-driven export builder is a separate,
  riskier slice. STP is a read surface (like risk_overview + cra_monitoring_focus,
  both exportEnabled:false). No export-path files change.
- **Exhaustive-map fallout (forced by the compiler):** the new artifact type
  forces an entry in ARTIFACT_TYPE_LABELS, DELIVERABLE_CONFIGS, and
  DELIVERABLE_COPY — each a `Record<DeliverableArtifactType, …>`. That is the
  design working as intended (a hand-listed set would silently go stale).

## Scope (files allowed)

- `plans/fable/site-training-priorities.md` — this file.
- `src/types/deliverables/index.ts` — artifact type + label; STP section keys/order/labels.
- `src/lib/deliverables/selection/siteTrainingPriorities.ts` — NEW pure ruleset.
- `src/lib/deliverables/selection/__tests__/siteTrainingPriorities.test.ts` — NEW.
- `supabase/migrations/20260716000000_deliverable_site_training_priorities.sql` — NEW (Approved-by Roger).
- `src/components/deliverables/deliverableConfigs.ts` — STP config entry.
- `src/components/deliverables/DeliverablePanel.tsx` — DELIVERABLE_COPY entry.
- `src/components/dashboard/sponsor/deliverables/ProtocolIntelligenceTab.tsx` — 5th picker chip.

## Out of scope (files forbidden)

- `src/lib/deliverables/deliverablesExportApi.ts` + `exporters/**` — export
  stays disabled for STP v1 (builder generalization is a separate slice).
- `src/lib/deliverables/selection/{monitoringChecklist,riskOverview,craMonitoringFocus,sivPackage}.ts`
  — frozen; STP duplicates the shared readers/taxonomy per the KEEP IN SYNC contract.
- `src/components/dashboard/cra/**` — STP is sponsor-facing v1; CRA picker unchanged.
- Other mode dirs, other migrations, the adapter (packet is artifact-agnostic;
  new section keys pass through as strings, existing block types only).

## Architecture layers touched

- [x] migration (enum value + generate v7 branch)
- [x] RPC (deliverable_generate)
- [ ] adapter (no change — artifact-agnostic packet)
- [ ] context
- [x] component (config, copy, picker chip)
- [x] test (selection spec + section/config invariants)

## Mock data plan

None.

## Approved-by

- Roger (`supabase/**`) — the migration.
- Every `src/…` file is Fable-owned (`src/types/deliverables/`,
  `src/lib/deliverables/`, `src/components/deliverables/`,
  `src/components/dashboard/sponsor/deliverables/`).
- DB→TS mirror satisfied: migration + `src/types/deliverables/index.ts` both in diff.

## Verification

- [ ] typecheck / build green; new selection tests pass; zero new full-suite
  failures vs the same-env baseline.
- [ ] Migration: pglast parse_sql + parse_plpgsql clean; byte-diff proves the
  four prior branches + match/apply/log stage are unchanged (only guard list,
  v_title CASE, the new ELSIF, and the COMMENT differ).
- [ ] Manual (enterprise sub, Sponsor → Protocol Intelligence): 5th chip
  "Site Training Priorities"; Generate drafts training-voiced sections; every
  criterion/med/endpoint/visit/procedure/amendment card is evidence-linked;
  framing/safety/questions carry no confidence; regenerate preserves edits.
- [ ] `piqc-review` clean (append-only migration, DB→TS mirror, no `any`,
  semantic tokens, pure adapter untouched).

## Decisions encoded

1. **Fifth lens, not a fork.** Same fact pool + match/apply machinery; the
   only per-type code is one selection ruleset + one SQL ELSIF. The proof that
   "parse once, generate many" holds at five.
2. **Instructional register.** Training voice is the lens; tests pin
   distinctive prefixes so STP prose never collides with the other four.
3. **Export disabled v1.** Read surface now; a config-driven export builder
   (so STP + future types export without hardcoded monitoring section order)
   is the natural next slice.
4. **Sponsor-only v1.** Site training is pre-activation oversight; the monitor
   workspace stays its focused operational pair.
