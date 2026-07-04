---
owner: sixonelabs-piqc
feature: audit-investigator-foundation
status: merged
merged: 2026-07-04
started: 2026-07-03
target_pr: #404
---

# Investigator Site Audit — Phase 1 foundation scaffold

## Context

Audit Mode is a two-workflow Audit Workspace; the vendor arc (#391/#393/#395/#397) built the seam but
left `INVESTIGATOR_SITE_AUDIT` unbuilt (`stagesForWorkflow` returns `[]`, initiation shows it disabled,
audit creation hard-requires a vendor). This phase makes an investigator site audit real end-to-end:
new `sites` auditee, a 7-stage `ISA_*` pipeline, workflow-aware component dispatch, a live initiation
chooser, and a first Site Intake stage — **behavior-preserving for existing vendor audits**. It is the
foundation for the risk-engine / scope / prep / execution / report phases that follow (full arc in
`~/.claude/plans/can-you-access-this-crystalline-cake.md`).

## Scope (files allowed)

- supabase/migrations/20260709000000_audit_mode_investigator_stages_and_sites.sql
- supabase/migrations/20260709000100_audit_mode_investigator_onramp_rpcs.sql
- src/types/audit/enums.ts
- src/types/audit/objects.ts
- src/lib/audit/workflowStages.ts
- src/lib/audit/auditCreationApi.ts
- src/lib/audit/labels.ts
- src/lib/audit/__tests__/workflowStages.test.ts
- src/components/dashboard/audit/AuditWorkspaceShell.tsx
- src/components/dashboard/audit/AuditRequiredGate.tsx
- src/components/dashboard/audit/onboarding/NewAuditDrawer.tsx
- src/components/dashboard/audit/stages/investigator/*.tsx
- src/context/AuditContext.tsx
- src/components/Navbar.tsx
  (mechanical compile fix + one-line auditee rendering: it duplicated an exhaustive
  `Record<AuditStage, string>` stage-label map that breaks when the union gains ISA stages —
  swapped to the shared `STAGE_LABELS` import; audit-switcher row now renders `auditee_name`
  so site audits don't show a blank vendor slot)
- src/lib/heatmap.ts
  (mechanical compile fix: `scoreStage` is an exhaustive switch over `AuditStage`; the widened
  union makes the end reachable → TS2366. ISA stages return 'none' — the heat heuristic is
  vendor-stage-derived)
- src/lib/audit/__tests__/lineageAdapter.test.ts
- src/lib/audit/__tests__/lineageApi.test.ts
  (mechanical compile fix: `AuditWithContext` fixtures gain the 4 new required auditee fields)
- src/lib/audit/lineageAdapter.ts
  (one-line: seed node title `vendor_name || 'Auditee'` → `auditee_name || 'Auditee'` —
  behavior-identical for vendor audits)
- src/components/dashboard/audit/RiskSummaryPanel.tsx
  (dedupe only: delete its local clinical-trial-phase label map, import the shared
  `CLINICAL_TRIAL_PHASE_LABELS` added in this diff)
- supabase/functions/audit-mode-chat/index.ts
  (allow-list extension: `VALID_VIEWED_STAGES` gains the 7 ISA_* values so PIQC chat doesn't 400
  on investigator audits; needs an edge-function redeploy alongside the migrations)
- docs/audit/two-workflow-architecture.md
- plans/sixonelabs-piqc/audit-investigator-foundation.md

## Out of scope (files forbidden)

- src/components/dashboard/audit/StageNav.tsx  — already `stages`-prop driven; needs no change
- src/components/dashboard/audit/stages/*.tsx (vendor stage workspaces) — untouched
- src/lib/audit/lineageAdapter.ts / lineageApi.ts / capaApi.ts — reused unchanged; extended in later phases
- src/lib/audit/intakeApi.ts, riskSummaryApi.ts, reportApi.ts — later phases
- any src/lib/site/**, src/lib/sotr/**, src/lib/deliverables/** — other lanes/features

## Architecture layers touched

- [x] migration (`supabase/migrations/`)
- [x] RPC (`.sql`)
- [ ] adapter
- [x] context (`src/context/AuditContext.tsx`)
- [x] component (`src/components/dashboard/audit/**`)
- [x] test (`workflowStages.test.ts`)

## Mock data plan

none — real Supabase from the start (CLAUDE.md non-negotiable #1). The MD's "local mock data first" is
explicitly rejected.

## Approved-by

- @karl-dev-piqc — audit lane: `src/types/audit/*`, `src/lib/audit/*`, `src/components/dashboard/audit/*`
- @rv61 — backend: `supabase/migrations/*`
- @ish-dev-piqc + @ki-dev-piqc — shared infra: `src/context/AuditContext.tsx` (2 reviewers required)

## Deferred (documented, not built)

- **`listSites`/`listVendors` failure vs "no records yet" are indistinguishable in the drawer**
  (both render an empty dropdown). Pre-existing pattern shared with the vendor path —
  distinguishing them means moving `auditCreationApi` reads to `Result<T>`, a joint refactor that
  belongs in its own cleanup, not this foundation PR. Create/save failures DO surface visible
  signals (added this PR).
- **ISA stages carry no heat in `scoreStage`** (explicit `'none'` cases) — the friction heuristic is
  vendor-history-derived; ISA gets its own signal base once the pipeline has usage.
- **PIQC write-back + vendor risk-summary rail are vendor-gated**, not re-targeted — the ISA report
  and ISA risk surfaces land with `ISA_REPORT` / `ISA_RISK_ASSESSMENT` phases.

## Verification

- [ ] Migrations apply: `sites` + RLS; `audits.vendor_id` nullable + `site_id` + `workflow_type`-keyed
      CHECK; 7 `audit_stage` ISA values; `audit_mode_create_site` + updated `audit_mode_create_audit`.
- [ ] Behavior-preserving: existing vendor audits render identically (8 stages, vendor header, dispatch
      unchanged); `workflowStages.test` green.
- [ ] New audit → choose Investigator → site/PI + protocol → creates `INVESTIGATOR_SITE_AUDIT` at
      `ISA_SITE_INTAKE`; StageNav shows 7 ISA stages; Site Intake renders; other 6 show placeholder.
- [ ] DB: investigator audit `vendor_id` NULL / `site_id` set; CHECK enforces the pairing; AuditContext
      SELECTs `workflow_type` + site join; header + hub show the site name.
- [ ] `npx tsc --noEmit` strict (no `any` in lib), `npm test`, `/piqc-review` clean.
