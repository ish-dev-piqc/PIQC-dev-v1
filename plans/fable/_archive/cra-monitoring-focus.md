---
owner: fable-dev-piqc
feature: cra-monitoring-focus
status: merged
merged: 2026-07-04
started: 2026-07-04
target_pr: #414
---

# CRA Monitoring Focus — third artifact_type + risk-lens prohibited-med debt

## Context

Handover §6.1-D: a protocol-derived **verification-emphasis** view for
monitors — where should a CRA's limited on-site attention go — hosted as
the third deliverable in the Sponsor Protocol Intelligence tab (the CRA
mode shell is a later, separate plumbing PR). Third lens on the engine,
zero new tables, and the first consumer of the prohibited_med facts that
landed in #412. Also settles that plan's named debt: `risk_overview`
now consumes prohibited_med facts too.

Distinctiveness rule: checklist = imperative task cards ("Verify: …");
risk overview = fragility factors ("where execution is fragile"); CRA
focus = **attention allocation** ("Prioritize verification of …").
Same facts, different question — never duplicate prose across lenses.

## Design

### Selection — `selection/craMonitoringFocus.ts` (pure spec + tests)

Sections (`CraFocusSectionKey`), fact cards with evidence passthrough,
framing intros, no scores, protocol-only (no site context — Phase-1
boundary: "do not pretend protocol-only data knows what happened at a
site"):

- `eligibility_verification_emphasis` — complex criteria (reuse the
  risk lens's conditional/length heuristics) AND every prohibited_med
  fact → "Prioritize eligibility verification: …" cards.
- `fragile_visit_windows` — total window ≤ 2 days → on-site
  window-verification priority cards.
- `endpoint_critical_verification` — primary endpoints → source-data
  verification priority cards.
- `vendor_specimen_workflows` — keyword heuristic over visit procedures
  (KEEP IN SYNC taxonomy), forced `low` confidence.
- `amendment_sensitive_requirements` — amendment card / confirm-version
  fallback framing.

### Risk-lens debt — `selection/riskOverview.ts`

`eligibility_complexity` additionally emits one fact card per
prohibited_med ("Restricted medication in eligibility scope: <med>")
with evidence passthrough; intro counts updated. Tests extended.

### Migration — `20260711000000_deliverable_cra_focus.sql`

`ALTER TYPE deliverable_artifact_type ADD VALUE 'cra_monitoring_focus'`
+ `CREATE OR REPLACE deliverable_generate` (v4): new CRA branch ported
from the TS spec; risk branch gains ONLY the med-card addition; the
checklist branch and all shared machinery byte-preserved from v3.
Same enum-in-transaction hazard note as v2. Per-type title: 'CRA
Monitoring Focus — Draft Preparation Aid'.

### Types + UI

Enum value + `ARTIFACT_TYPE_LABELS` entry (this ALSO extends the
adapter whitelist automatically — it derives from the labels map since
the #409 fix; reviewers verify, no adapter edit). `CraFocusSectionKey`
+ order + labels. `ProtocolIntelligenceTab`: third picker chip +
config entry (CRA focus sections, exportEnabled false — same deferral
decision as risk). `DeliverablePanel` untouched (props already carry
everything).

## Scope (files allowed)

- `plans/fable/cra-monitoring-focus.md` — this file.
- `src/types/deliverables/index.ts` — enum, labels, CRA section vocabulary.
- `src/lib/deliverables/selection/craMonitoringFocus.ts` (+ test, new).
- `src/lib/deliverables/selection/riskOverview.ts` + its test — med debt.
- `src/components/dashboard/sponsor/deliverables/ProtocolIntelligenceTab.tsx`.
- `src/components/dashboard/sponsor/deliverables/DeliverablePanel.tsx` —
  ONE map entry: DELIVERABLE_COPY is Record<DeliverableArtifactType, …>
  (exhaustive by type), so the new enum value REQUIRES a noun/emptyBody
  entry. Build surfaced this; the out-of-scope claim below was wrong for
  exhaustive maps.
- `supabase/migrations/*_deliverable_cra_focus.sql` — new migration.

## Out of scope (files forbidden)

- `selection/monitoringChecklist.ts` — checklist untouched this slice.
- `src/components/deliverables/` — no UI machinery changes.
  (DeliverablePanel: copy-map entry ONLY — see Scope.)
- `deliverablesAdapter.ts` — whitelist extends via the labels map by
  design; an edit here means the design broke (investigate, don't patch).
- CRA mode plumbing (`ModeContext`, `LeftRail`, `Dashboard`, `App`,
  `entitlements`) — the NEXT slice, 2-reviewer shared files.
- SOTR/site/audit/VEW, ingest pipeline, export builder, merged migrations.

## Architecture layers touched

- [x] migration (1 new: enum value + generate v4)
- [x] RPC (CRA branch added; risk branch med cards)
- [ ] adapter (extends automatically via ARTIFACT_TYPE_LABELS — verify only)
- [ ] context
- [x] component (tab picker config only)
- [x] test (CRA spec suite; risk-lens med tests)

## Mock data plan

None.

## Approved-by

- Roger (`@rv61`) — `supabase/migrations/*`.

## Verification

- [x] `npm run typecheck` / `build` / deliverables + sotr suites green
  (322/322); new CRA spec suite green (48); risk-lens med tests green;
  zero new full-suite failures vs same-environment baseline.
- [ ] Manual (post `db push`): third chip renders → Generate CRA focus →
  attention-allocation cards with evidence + confidence, prohibited
  meds present in eligibility emphasis → review/edit/reject/regenerate
  behave → checklist + risk overview unregressed; risk overview now
  shows med cards after regenerate.
- [x] No numeric scores anywhere; prose distinct from the other two
  lenses (no duplicated card text — test-asserted both directions).
- [x] `piqc-review` clean.

## Decisions encoded

1. **Hosted in Sponsor intelligence tab, not a CRA mode** — the mode
   shell is separate, later, and needs the workspace content anyway
   (handover puts CRA Monitoring Focus in Sponsor Mode §6.1-D).
2. **Protocol-only**: no site/participant context in any prose; context
   overlays are a later phase (handover §6.2 boundary).
3. **Attention-allocation prose register** — never duplicates checklist
   or risk card text for the same underlying fact.
4. **Export deferred** (same as risk overview; revisit = sponsor asks
   for a monitoring prep packet — at which point the checklist export
   pattern generalizes).
5. Risk-lens med debt settled HERE per the trigger named in
   plans/fable/_archive-bound prohibited-meds plan (Decision 3).
