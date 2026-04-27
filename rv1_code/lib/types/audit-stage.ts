// =============================================================================
// Audit stage types (D-010)
// =============================================================================

import { AuditStage } from "@prisma/client";
import { z } from "zod";

export interface TransitionAuditStageInput {
  auditId: string;
  toStage: AuditStage;
  actorId: string;
  reason?: string;
}

export const TransitionAuditStageSchema = z.object({
  toStage: z.nativeEnum(AuditStage),
  actorId: z.string().uuid(),
  reason: z.string().optional(),
});

// Linear stage order — index in this array == position in workflow.
// Forward transitions must move exactly +1; backward (any number of steps) is
// allowed without an approval gate (auditors revisit prior stages routinely).
export const STAGE_ORDER: readonly AuditStage[] = [
  AuditStage.INTAKE,
  AuditStage.VENDOR_ENRICHMENT,
  AuditStage.QUESTIONNAIRE_REVIEW,
  AuditStage.SCOPE_AND_RISK_REVIEW,
  AuditStage.PRE_AUDIT_DRAFTING,
  AuditStage.AUDIT_CONDUCT,
  AuditStage.REPORT_DRAFTING,
  AuditStage.FINAL_REVIEW_EXPORT,
] as const;

export function stageIndex(stage: AuditStage): number {
  return STAGE_ORDER.indexOf(stage);
}
