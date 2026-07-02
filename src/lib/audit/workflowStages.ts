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
// INVESTIGATOR_SITE_AUDIT's stage set is defined in its own initiative; it is
// empty here because the workflow is selectable-but-disabled at initiation, so no
// audit is ever persisted with that type yet.
//
// Pure module — no React, no Supabase. The stage → component dispatch map stays
// in AuditWorkspaceShell (it imports the stage components); this resolver only
// owns the ordered list of stages.
// =============================================================================

import { AUDIT_STAGES, type AuditStage, type AuditWorkflowType } from '../../types/audit';

const INVESTIGATOR_SITE_AUDIT_STAGES: readonly AuditStage[] = [];

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
