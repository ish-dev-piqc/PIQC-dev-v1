// =============================================================================
// TrustAssessmentObject library
//
// Structured capture of front-end vendor intelligence. One per Audit.
// All mutations write a StateHistoryDelta — posture changes are especially
// important to trace since they inform downstream questionnaire scope.
// =============================================================================

import { TrackedObjectType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { diffFields, writeDelta } from "@/lib/state-history";
import {
  CreateTrustAssessmentInput,
  UpdateTrustAssessmentInput,
} from "@/lib/types/trust-assessment";

export async function createTrustAssessment(
  auditId: string,
  input: CreateTrustAssessmentInput
) {
  return prisma.$transaction(async (tx) => {
    const assessment = await tx.trustAssessmentObject.create({
      data: {
        auditId,
        certificationsClaimed: input.certificationsClaimed,
        regulatoryClaims: input.regulatoryClaims,
        compliancePosture: input.compliancePosture,
        maturityPosture: input.maturityPosture,
        provisionalTrustPosture: input.provisionalTrustPosture,
        riskHypotheses: input.riskHypotheses,
        notes: input.notes ?? null,
        assessedBy: input.assessedBy,
        assessedAt: new Date(),
      },
    });

    await writeDelta(
      tx,
      TrackedObjectType.TRUST_ASSESSMENT_OBJECT,
      assessment.id,
      {
        certificationsClaimed:    { from: null, to: assessment.certificationsClaimed },
        regulatoryClaims:         { from: null, to: assessment.regulatoryClaims },
        compliancePosture:        { from: null, to: assessment.compliancePosture },
        maturityPosture:          { from: null, to: assessment.maturityPosture },
        provisionalTrustPosture:  { from: null, to: assessment.provisionalTrustPosture },
        riskHypotheses:           { from: null, to: assessment.riskHypotheses },
      },
      input.assessedBy,
      "Initial trust assessment"
    );

    return assessment;
  });
}

export async function updateTrustAssessment(
  assessmentId: string,
  input: UpdateTrustAssessmentInput
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.trustAssessmentObject.findUniqueOrThrow({
      where: { id: assessmentId },
    });

    const changed = diffFields(
      {
        certificationsClaimed:   existing.certificationsClaimed,
        regulatoryClaims:        existing.regulatoryClaims,
        compliancePosture:       existing.compliancePosture,
        maturityPosture:         existing.maturityPosture,
        provisionalTrustPosture: existing.provisionalTrustPosture,
        riskHypotheses:          existing.riskHypotheses,
        notes:                   existing.notes,
      },
      input.values
    );

    const updated = await tx.trustAssessmentObject.update({
      where: { id: assessmentId },
      data: input.values,
    });

    await writeDelta(
      tx,
      TrackedObjectType.TRUST_ASSESSMENT_OBJECT,
      assessmentId,
      changed,
      input.actorId,
      input.reason ?? "Trust assessment updated"
    );

    return updated;
  });
}

export async function getTrustAssessment(auditId: string) {
  return prisma.trustAssessmentObject.findUnique({ where: { auditId } });
}
