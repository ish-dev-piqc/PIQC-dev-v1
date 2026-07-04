# Audit Mode — two-workflow architecture (Vendor + Investigator Site)

Status: **active** · Introduced by `feat/audit-workspace-foundation` (2026-07-02) ·
Investigator workflow foundation added by `feat/audit-investigator-foundation` (2026-07-03)

## Vision

Audit Mode is a single **Audit Workspace**. The auditor initiates a **Vendor Audit** or an
**Investigator Site Audit** workflow, then manages and stays up to date with their workload across all
audits. Today only the Vendor Audit workflow is live; this document records the seam that makes the
two-workflow shape real and the path to add the investigator workflow smoothly.

## The seam (built now)

- **`AuditWorkflowType`** (`src/types/audit/enums.ts`) = `'VENDOR_AUDIT' | 'INVESTIGATOR_SITE_AUDIT'`,
  mirrored by the Postgres `audit_workflow_type` enum + `audits.workflow_type` column
  (`supabase/migrations/20260705000000_audit_mode_workflow_type.sql`, default `VENDOR_AUDIT`).
- **Stage resolver** (`src/lib/audit/workflowStages.ts`): `stagesForWorkflow(workflowType)` returns the
  ordered `AuditStage[]` for a workflow. The shell / `StageNav` / mobile picker render whatever the
  resolver returns instead of the old global `AUDIT_STAGES` constant. `VENDOR_AUDIT` returns the
  canonical 8 stages verbatim (behavior-preserving — see `workflowStages.test.ts`).
- **Rollout ordering (expand-then-contract):** the frontend defaults `workflow_type` to `VENDOR_AUDIT`
  in `AuditContext.flatten` **without** SELECTing the column, so applying the migration is decoupled
  from the app deploy. The create-audit RPC is unchanged (the disabled investigator chooser means every
  new audit is `VENDOR_AUDIT`, which the column default produces).

## Investigator Site Audit — Phase 1 foundation (built)

`feat/audit-investigator-foundation` makes the investigator workflow real end-to-end while staying
behavior-preserving for vendor audits. Decisions and what shipped:

1. **Stage set — 7 `ISA_*` stages.** `INVESTIGATOR_SITE_AUDIT_STAGES` in `workflowStages.ts`:
   `ISA_SITE_INTAKE → ISA_RISK_ASSESSMENT → ISA_SCOPE_BUILDER → ISA_PREP → ISA_CONDUCT → ISA_REPORT →
   ISA_EXPORT`. All are new `AuditStage` union members + Postgres `audit_stage` values
   (`20260709000000`). They are `ISA_`-prefixed and **disjoint** from the vendor stages (pinned by
   `workflowStages.test.ts`) so a site audit never resolves a vendor component.
2. **Auditee — a new `sites` table, not a `Vendor` rename.** Rather than the originally-sketched
   `Vendor → Auditee` rename (a large, risky migration touching the live vendor flow), the site auditee
   is a separate `sites` table mirroring `vendors` (`20260709000000`). `audits.vendor_id` became
   nullable, `audits.site_id` was added, and a CHECK (`audits_auditee_matches_workflow`) ties the
   auditee to the workflow (vendor audits carry a vendor + no site; investigator carry a site + no
   vendor). Existing vendor rows satisfy it unchanged.
3. **Component dispatch is workflow-keyed.** `STAGE_COMPONENTS` in `AuditWorkspaceShell` went from
   `Record<AuditStage, Component>` to `Record<AuditWorkflowType, Partial<Record<AuditStage,
   Component>>>`. Investigator stages without a real workspace yet fall through to `IsaStagePlaceholder`,
   so the stage nav is fully walkable. Only `ISA_SITE_INTAKE` ships a real workspace in Phase 1.
4. **Initiation is live.** `NewAuditDrawer`'s chooser is a real radio pair; picking Investigator swaps
   the vendor field for a site/PI picker. `audit_mode_create_audit` was dropped + recreated with
   `p_workflow_type` + `p_site_id` (vendor path defaults preserved), and lands the audit at the
   workflow's first stage. `AuditContext` now SELECTs `workflow_type`, left-joins `sites`, and exposes
   `auditee_name` (vendor **or** site name) so the header and hub are workflow-agnostic.
5. **Reused unchanged.** Findings/observations, questionnaire, report drafting, export, state-history,
   the PIQC assistant, lineage/traceability, and the Issue→CAPA loop are auditee-neutral — later ISA
   phases wire investigator objects into them, they need no rework.

## What later ISA phases add

Risk engine (protocol/site risk profiles + I×L×D `RiskFactor` scoring, PIQC-native hybrid — derive from
the parsed protocol, auditor confirms), scope + checklist generation (risk → modules → traceable
checklist items), audit prep (document requests + subject sampling), execution/findings/evidence
(reusing the Issue→CAPA loop), and the investigator report/export. See the initiative plan for phasing.

## Design principle

Keep new shared code **auditee-neutral** (root of a lineage = generic *seed/auditee*, not hardcoded
`Vendor`; display uses `auditee_name`). The seam is justified by the two-workflow vision, so it is not a
single-caller abstraction. Investigator-specific behavior lands phase by phase, not speculatively.
