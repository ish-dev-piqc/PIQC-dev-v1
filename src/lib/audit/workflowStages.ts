// =============================================================================
// workflowStages — resolves the ordered stage set for an audit workflow.
//
// Audit Mode is a two-workflow Audit Workspace. The stage pipeline is no longer a
// single global constant: it is a function of the audit's workflow_type. This
// keeps the shell / StageNav / mobile picker workflow-agnostic — they render
// whatever stage list the resolver returns for the active audit.
//
// VENDOR_AUDIT returns the canonical 8-stage pipeline (AUDIT_STAGES) verbatim, so
// existing vendor audits are behavior-preserving (see workflowStages.test.ts).
// INVESTIGATOR_SITE_AUDIT returns its own 7-stage ISA_* pipeline (Phase 1
// foundation) — a site audit never shares a stage with the vendor flow.
//
// Pure module — no React, no Supabase. The stage → component dispatch map stays
// in AuditWorkspaceShell (it imports the stage components); this resolver only
// owns the ordered list of stages.
// =============================================================================

import { AUDIT_STAGES, type AuditStage, type AuditWorkflowType } from '../../types/audit';

// Investigator Site Audit pipeline (20260709000000). Only ISA_SITE_INTAKE ships
// a real workspace in Phase 1; the rest render a "coming in a later phase"
// placeholder so StageNav is navigable end-to-end. Module-private — consumers
// go through stagesForWorkflow.
const INVESTIGATOR_SITE_AUDIT_STAGES: readonly AuditStage[] = [
  'ISA_SITE_INTAKE',
  'ISA_RISK_ASSESSMENT',
  'ISA_SCOPE_BUILDER',
  'ISA_PREP',
  'ISA_CONDUCT',
  'ISA_REPORT',
  'ISA_EXPORT',
] as const;

export function stagesForWorkflow(
  workflowType: AuditWorkflowType,
): readonly AuditStage[] {
  switch (workflowType) {
    case 'VENDOR_AUDIT':
      return AUDIT_STAGES;
    case 'INVESTIGATOR_SITE_AUDIT':
      return INVESTIGATOR_SITE_AUDIT_STAGES;
  }
}

// Has the audit's workflow position reached `stage`? Stage workspaces use this
// to distinguish a real visit (current or past — fully live) from the one-ahead
// preview the nav allows, where mutating actions and mount-time writes must
// stay off. Fails safe: a stage that isn't in this workflow's pipeline (or a
// currentStage that isn't) is never "reached".
export function hasReachedStage(
  workflowType: AuditWorkflowType,
  currentStage: AuditStage,
  stage: AuditStage,
): boolean {
  const stages = stagesForWorkflow(workflowType);
  const currentIdx = stages.indexOf(currentStage);
  const stageIdx = stages.indexOf(stage);
  return currentIdx >= 0 && stageIdx >= 0 && currentIdx >= stageIdx;
}

// Has the audit advanced PAST `stage`? Stage workspaces use this for their
// "audit has already advanced past this stage" messaging and to disable
// their own advance action — replacing four hand-maintained downstream-stage
// string arrays (PR-4) that were never ISA-aware and drifted per file.
// Same fail-safe as hasReachedStage: unknown stage or workflow → false.
export function hasPassedStage(
  workflowType: AuditWorkflowType,
  currentStage: AuditStage,
  stage: AuditStage,
): boolean {
  const stages = stagesForWorkflow(workflowType);
  const currentIdx = stages.indexOf(currentStage);
  const stageIdx = stages.indexOf(stage);
  return currentIdx >= 0 && stageIdx >= 0 && currentIdx > stageIdx;
}
