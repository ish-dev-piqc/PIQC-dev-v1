---
owner: fable-dev-piqc
feature: risk-overview
status: active
started: 2026-07-03
target_pr:
---

# Sponsor Risk Overview — second artifact_type on the Deliverable Engine

## Context

Phase-2 opener from the Protocol Intelligence handover (§6.1-A "Protocol
Risk Overview"): explainable-complexity cards derived deterministically
from the SAME protocol facts the monitoring checklist selects — rendered
as a second deliverable in the Sponsor Protocol Intelligence tab. This is
deliberately the engine's reusability proof pulled forward: **a new
`artifact_type` end-to-end with ZERO new tables.** No opaque risk scores
anywhere — every card names its explainable factor and links to evidence
(handover doctrine).

## Design

### Selection (deterministic, no LLM) — `selection/riskOverview.ts`

Pure TS spec + tests; ported into the generate RPC. Sections
(`RiskOverviewSectionKey`), all cards `content_origin='protocol_fact'`
with evidence passthrough unless noted:

- `eligibility_complexity` — criteria whose text contains conditional
  language (`if / unless / except / prior / history of / within`) or runs
  long (> 220 chars) → "Complex eligibility — <why>: <text>". Intro
  framing carries the counts (X of Y criteria flagged).
- `visit_window_pressure` — visits with total window ≤ 2 days (incl. 0/0
  exact-day) → narrow-window cards.
- `endpoint_critical_procedures` — PRIMARY endpoints only (secondary =
  noise per the cognitive-load north star) → verification-emphasis cards.
- `vendor_lab_imaging_dependencies` — same keyword taxonomy as the
  checklist's section 6 over visit procedures; forced `low` confidence.
- `coordination_burden` — visits with ≥ 8 procedures → dense-visit cards
  (multi-role coordination pressure).
- `amendment_sensitivity` — `amendment_summary` present → fact card;
  absent → framing note to confirm current version.

Reuses the fact-pool contract from the checklist (field_path ordering,
SOTR `current_text` wins, `rejected_from_draft` excluded).

### Migration (`*_deliverable_risk_overview.sql`, append-only)

- `ALTER TYPE deliverable_artifact_type ADD VALUE 'risk_overview';`
- `CREATE OR REPLACE FUNCTION deliverable_generate` — dispatch per
  artifact_type: existing checklist branch byte-preserved; new risk
  branch ports `riskOverview.ts`; title per type ('Protocol Risk
  Overview'). Same fingerprint/regenerate semantics (they are
  artifact-agnostic).
- HAZARD note: a new enum value cannot be USED in the same transaction
  that adds it (PG12+). Safe here — `CREATE FUNCTION` stores the body as
  text; no immediate cast/DML uses the value.
- `deliverable_get_packet` / mutations / RLS are artifact-agnostic —
  untouched.

### Types + generic UI (2nd-use-case generalization, now justified)

- `DeliverableArtifactType` += `'risk_overview'`; add `RISK_SECTION_ORDER`
  + `RISK_SECTION_LABELS`; generalize `groupBlocksBySection(blocks,
  order?)` (default = monitoring order, back-compat).
- `DeliverableBlockList` accepts optional `sectionOrder` / `sectionLabels`
  props (defaults = monitoring — checklist callers unchanged).
- `MonitoringChecklistPanel` → generalized `DeliverablePanel`
  (props: protocolId, artifactType, sectionOrder/labels, exportEnabled)
  — two callers now exist, so the abstraction earns its keep.
  `ProtocolIntelligenceTab` gains a two-chip deliverable picker
  (Monitoring Prep Checklist | Risk Overview).

## Scope (files allowed)

- `plans/fable/risk-overview.md` — this file.
- `src/types/deliverables/` — enum value, risk section vocabulary,
  groupBlocksBySection generalization.
- `src/lib/deliverables/` — `selection/riskOverview.ts` + tests; existing
  tests updated only where the generalization touches signatures.
- `src/components/deliverables/` — DeliverableBlockList label/order props.
- `src/components/dashboard/sponsor/deliverables/` — DeliverablePanel
  generalization + tab picker.
- `supabase/migrations/*_deliverable_risk_overview.sql` — new migration.

## Out of scope (files forbidden)

- `src/components/dashboard/sponsor/SponsorPage.tsx`,
  `SponsorProtocolDrawer.tsx`, `src/lib/sponsor/`, `src/types/sponsor/` —
  Kiara's territory; NOT needed this slice.
- `src/lib/{sotr,site,audit,visit-execution}/` + their dashboards/types.
- `src/lib/deliverables/deliverablesExportApi.ts` — no risk-overview
  export FEATURE (see Decisions); signature-compat updates for the
  groupBlocksBySection generalization are allowed (mechanical only).
- `src/lib/entitlements.ts`, `src/context/`, `supabase/functions/`.
- Merged migrations (20260708*) — append-only; the new migration
  redefines `deliverable_generate` via CREATE OR REPLACE.

## Architecture layers touched

- [x] migration (1 new: enum value + generate dispatch)
- [x] RPC (deliverable_generate replaced with per-type dispatch)
- [ ] adapter (packet shape unchanged — artifact-agnostic)
- [ ] context
- [x] component (BlockList props, DeliverablePanel, tab picker)
- [x] test (riskOverview selection; BlockList/panel regressions)

## Mock data plan

None.

## Approved-by

- Roger (`@rv61`) — `supabase/migrations/*`

## Verification

- [ ] `npm run typecheck`, `npm run build`, `npm test` clean; new
  `riskOverview.test.ts` green; existing 139 deliverables tests still
  green (checklist regression).
- [ ] Manual: Protocol Intelligence tab → picker shows both deliverables →
  Generate Risk Overview → cards grouped by risk section with factor
  prose + evidence chips + confidence → traceability drawer works →
  review/edit/reject/add work → regenerate preserves human work →
  checklist unchanged (default props).
- [ ] No numeric risk score rendered anywhere (doctrine check).
- [ ] `piqc-review` clean.

## Decisions encoded (don't re-litigate without reading these)

1. **Zero new tables/block_types.** Cards reuse `checklist_item` /
   `section_intro`. A distinct `risk_card` block_type only arrives if a
   lens needs distinct rendering (revisit trigger).
2. **Explainable factors only — no scores.** Handover explicitly bans
   opaque risk scores; every card states WHY in prose + evidence.
3. **Primary endpoints only** in the endpoint section (secondary = noise).
4. **Risk-overview PDF export deferred.** It is an on-screen intelligence
   view first; the export builder stays checklist-labeled. Revisit when a
   sponsor asks for a packet.
5. **DeliverablePanel generalization now** — two real callers exist; the
   single-caller rule no longer blocks it.
6. Thresholds (220 chars, ≤ 2-day window, ≥ 8 procedures) are v1
   heuristics, deliberately conservative; tune with founder feedback.
