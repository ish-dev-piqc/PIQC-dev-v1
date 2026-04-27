// =============================================================================
// Tests: lib/trust-assessments.ts
//
// Covers: createTrustAssessment, updateTrustAssessment, getTrustAssessment
//
// posture fields (compliancePosture, maturityPosture, provisionalTrustPosture)
// are under active design decision (D-005). Tests use valid enum values but
// avoid asserting on enum semantics — the enum labels are placeholders.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  CompliancePosture,
  MaturityPosture,
  TrustPosture,
} from "@prisma/client";
import {
  createTrustAssessment,
  getTrustAssessment,
  updateTrustAssessment,
} from "@/lib/trust-assessments";
import { prisma } from "@/lib/prisma";
import { seedAuditWithContext } from "../helpers/factory";

const baseInput = {
  certificationsClaimed: ["ISO 13485", "GMP"],
  regulatoryClaims: ["FDA 21 CFR Part 11"],
  compliancePosture: CompliancePosture.ADEQUATE,
  maturityPosture: MaturityPosture.MATURE,
  provisionalTrustPosture: TrustPosture.MODERATE,
  riskHypotheses: ["Chain of custody gaps", "Manual data transcription risk"],
};

// =============================================================================
// createTrustAssessment
// =============================================================================

describe("createTrustAssessment", () => {
  it("creates the assessment and writes a delta", async () => {
    const { audit, actor } = await seedAuditWithContext();

    const assessment = await createTrustAssessment(audit.id, {
      ...baseInput,
      assessedBy: actor.id,
    });

    expect(assessment.auditId).toBe(audit.id);
    expect(assessment.certificationsClaimed).toEqual(["ISO 13485", "GMP"]);
    expect(assessment.assessedBy).toBe(actor.id);

    const delta = await prisma.stateHistoryDelta.findFirst({
      where: { objectId: assessment.id },
    });
    expect(delta).not.toBeNull();
    expect(delta?.actorId).toBe(actor.id);
    expect(delta?.reason).toBe("Initial trust assessment");
  });

  it("stores an optional notes field", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const assessment = await createTrustAssessment(audit.id, {
      ...baseInput,
      assessedBy: actor.id,
      notes: "Vendor was unresponsive during pre-audit information request.",
    });
    expect(assessment.notes).toBe("Vendor was unresponsive during pre-audit information request.");
  });

  it("leaves notes null when not supplied", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const assessment = await createTrustAssessment(audit.id, {
      ...baseInput,
      assessedBy: actor.id,
    });
    expect(assessment.notes).toBeNull();
  });

  it("stores all array fields correctly", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const assessment = await createTrustAssessment(audit.id, {
      ...baseInput,
      assessedBy: actor.id,
    });
    expect(assessment.certificationsClaimed).toEqual(["ISO 13485", "GMP"]);
    expect(assessment.regulatoryClaims).toEqual(["FDA 21 CFR Part 11"]);
    expect(assessment.riskHypotheses).toEqual(["Chain of custody gaps", "Manual data transcription risk"]);
  });
});

// =============================================================================
// getTrustAssessment
// =============================================================================

describe("getTrustAssessment", () => {
  it("returns null when no assessment exists for the audit", async () => {
    const { audit } = await seedAuditWithContext();
    const result = await getTrustAssessment(audit.id);
    expect(result).toBeNull();
  });

  it("returns the assessment by auditId", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const created = await createTrustAssessment(audit.id, {
      ...baseInput,
      assessedBy: actor.id,
    });
    const result = await getTrustAssessment(audit.id);
    expect(result?.id).toBe(created.id);
    expect(result?.provisionalTrustPosture).toBe(TrustPosture.MODERATE);
  });
});

// =============================================================================
// updateTrustAssessment
// =============================================================================

describe("updateTrustAssessment", () => {
  it("updates changed fields and writes a delta", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const assessment = await createTrustAssessment(audit.id, {
      ...baseInput,
      assessedBy: actor.id,
    });

    const updated = await updateTrustAssessment(assessment.id, {
      values: { provisionalTrustPosture: TrustPosture.LOW },
      actorId: actor.id,
      reason: "Elevated risk: missing batch records",
    });

    expect(updated.provisionalTrustPosture).toBe(TrustPosture.LOW);

    const deltas = await prisma.stateHistoryDelta.findMany({
      where: { objectId: assessment.id },
      orderBy: { createdAt: "asc" },
    });
    // First delta: creation. Second delta: posture change.
    expect(deltas).toHaveLength(2);
    const updateDelta = deltas[1];
    expect((updateDelta.changedFields as Record<string, unknown>).provisionalTrustPosture).toBeDefined();
    expect(updateDelta.reason).toBe("Elevated risk: missing batch records");
    expect(updateDelta.actorId).toBe(actor.id);
  });

  it("only writes delta fields that actually changed", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const assessment = await createTrustAssessment(audit.id, {
      ...baseInput,
      assessedBy: actor.id,
    });

    await updateTrustAssessment(assessment.id, {
      values: {
        provisionalTrustPosture: TrustPosture.LOW,
        compliancePosture: baseInput.compliancePosture, // unchanged
      },
      actorId: actor.id,
    });

    const deltas = await prisma.stateHistoryDelta.findMany({
      where: { objectId: assessment.id },
      orderBy: { createdAt: "asc" },
    });
    const updateDelta = deltas[1];
    const fields = updateDelta.changedFields as Record<string, unknown>;
    expect(fields.provisionalTrustPosture).toBeDefined();
    expect(fields.compliancePosture).toBeUndefined();
  });

  it("does not write a delta when no fields actually change", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const assessment = await createTrustAssessment(audit.id, {
      ...baseInput,
      assessedBy: actor.id,
    });

    const deltasBefore = await prisma.stateHistoryDelta.count({
      where: { objectId: assessment.id },
    });

    await updateTrustAssessment(assessment.id, {
      values: {
        certificationsClaimed: [...baseInput.certificationsClaimed],
        provisionalTrustPosture: baseInput.provisionalTrustPosture,
      },
      actorId: actor.id,
    });

    const deltasAfter = await prisma.stateHistoryDelta.count({
      where: { objectId: assessment.id },
    });
    expect(deltasAfter).toBe(deltasBefore);
  });

  it("updates array fields and reflects them in subsequent read", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const assessment = await createTrustAssessment(audit.id, {
      ...baseInput,
      assessedBy: actor.id,
    });

    await updateTrustAssessment(assessment.id, {
      values: { riskHypotheses: ["Updated hypothesis A", "Updated hypothesis B"] },
      actorId: actor.id,
    });

    const result = await getTrustAssessment(audit.id);
    expect(result?.riskHypotheses).toEqual(["Updated hypothesis A", "Updated hypothesis B"]);
  });
});
