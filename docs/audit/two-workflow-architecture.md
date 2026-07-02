# Audit Mode — two-workflow architecture (Vendor + Investigator Site)

Status: **active** · Introduced by `feat/audit-workspace-foundation` (2026-07-02)

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

## What the Investigator Site Audit initiative will add

The investigator workflow is a separate initiative (its own feature-intake/plan). It plugs into the
seam above; it does not rework it.

1. **Stage set.** Define the investigator stage list in `workflowStages.ts`
   (`INVESTIGATOR_SITE_AUDIT_STAGES`) — likely site/PI prep, ICF & source-data-verification scope,
   conduct, report, export. Add any investigator-only stages to the `AuditStage` union + stage
   components + the `STAGE_COMPONENTS` map in `AuditWorkspaceShell`.
2. **Auditee generalization (`Vendor → Auditee`).** The auditee of an investigator audit is a
   site/PI, not a vendor. Generalize:
   - `Auditee { auditee_type: 'VENDOR' | 'INVESTIGATOR_SITE' }`; `Vendor` becomes the VENDOR
     specialization (or an `investigator_site` table joins in parallel).
   - `audits.vendor_id → auditee_id` (keep a compat view/alias during the migration so existing
     vendor code keeps working while call sites move over).
   - Stage 2 (`VENDOR_ENRICHMENT` service/mapping/trust) becomes auditee-type-conditional: vendor
     enrichment for vendors, site/PI context for investigator sites.
3. **Initiation.** Flip the investigator option in `NewAuditDrawer` from disabled to live; branch the
   form (vendor path vs site/PI path); pass `workflow_type` through `audit_mode_create_audit` (add the
   param) and switch `AuditContext` to SELECT + read `workflow_type`.
4. **Reused unchanged.** Findings/observations, questionnaire, report drafting, export, state-history,
   the PIQC assistant, and (once built) the provenance/traceability graph + CAPA workflow are all
   auditee-neutral and require no investigator-specific rework.

## Design principle

Keep new shared code **auditee-neutral** (root of a lineage = generic *seed/auditee*, not hardcoded
`Vendor`). The seam is justified by the stated two-workflow vision, so it is not a single-caller
abstraction — but do not build investigator-specific behavior until its initiative.
