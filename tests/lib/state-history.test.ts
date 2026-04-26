// =============================================================================
// Tests: lib/state-history.ts
//
// Covers two surfaces:
//   1. diffFields — pure function, no DB required
//   2. getObjectHistory — DB read; relies on mutations that go through writeDelta
//
// The delta writer (writeDelta) is tested indirectly through the library
// functions (createTrustAssessment etc.) — those tests assert delta counts and
// actorId. Here we verify diffFields correctness and the history reader shape.
// =============================================================================

import { describe, expect, it } from "vitest";
import { CompliancePosture, MaturityPosture, TrackedObjectType, TrustPosture } from "@prisma/client";
import { diffFields, getObjectHistory } from "@/lib/state-history";
import { createTrustAssessment, updateTrustAssessment } from "@/lib/trust-assessments";
import { seedAuditWithContext } from "../helpers/factory";

// =============================================================================
// diffFields — pure function, no DB
// =============================================================================

describe("diffFields — primitives", () => {
  it("returns empty when before and after are identical", () => {
    const result = diffFields(
      { status: "DRAFT", score: 5 },
      { status: "DRAFT", score: 5 }
    );
    expect(result).toEqual({});
  });

  it("captures a single changed field", () => {
    const result = diffFields(
      { status: "DRAFT", score: 5 },
      { status: "APPROVED" }
    );
    expect(result).toEqual({
      status: { from: "DRAFT", to: "APPROVED" },
    });
  });

  it("captures multiple changed fields", () => {
    const result = diffFields(
      { a: 1, b: 2, c: 3 },
      { a: 10, b: 2, c: 30 }
    );
    expect(result).toEqual({
      a: { from: 1, to: 10 },
      c: { from: 3, to: 30 },
    });
  });

  it("treats null → value as changed", () => {
    const result = diffFields({ notes: null }, { notes: "Some note" });
    expect(result).toEqual({ notes: { from: null, to: "Some note" } });
  });

  it("treats value → null as changed", () => {
    const result = diffFields({ notes: "Some note" }, { notes: null });
    expect(result).toEqual({ notes: { from: "Some note", to: null } });
  });

  it("does not include keys present in before but absent from after (partial update)", () => {
    const result = diffFields(
      { a: 1, b: 2 },
      { a: 99 } // b is not in after — should not appear in delta
    );
    expect(result).toEqual({ a: { from: 1, to: 99 } });
    expect(result.b).toBeUndefined();
  });
});

describe("diffFields — arrays (JSON stringify comparison)", () => {
  it("returns empty when arrays are deeply equal", () => {
    const result = diffFields(
      { tags: ["a", "b", "c"] },
      { tags: ["a", "b", "c"] }
    );
    expect(result).toEqual({});
  });

  it("captures array order change as a diff", () => {
    const result = diffFields(
      { tags: ["a", "b"] },
      { tags: ["b", "a"] }
    );
    expect(result).toEqual({
      tags: { from: ["a", "b"], to: ["b", "a"] },
    });
  });

  it("captures element added to array", () => {
    const result = diffFields(
      { tags: ["a"] },
      { tags: ["a", "b"] }
    );
    expect(result).toEqual({
      tags: { from: ["a"], to: ["a", "b"] },
    });
  });

  it("captures null → empty array as changed", () => {
    const result = diffFields({ tags: null }, { tags: [] as string[] });
    expect(result).toEqual({ tags: { from: null, to: [] } });
  });
});

// =============================================================================
// getObjectHistory — DB reads
// =============================================================================

describe("getObjectHistory", () => {
  it("returns an empty array when no deltas exist for the object", async () => {
    const result = await getObjectHistory(
      TrackedObjectType.TRUST_ASSESSMENT_OBJECT,
      "00000000-0000-0000-0000-000000000000"
    );
    expect(result).toEqual([]);
  });

  it("returns the creation delta after createTrustAssessment", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const assessment = await createTrustAssessment(audit.id, {
      certificationsClaimed: ["ISO 13485"],
      regulatoryClaims: [],
      compliancePosture: CompliancePosture.ADEQUATE,
      maturityPosture: MaturityPosture.MATURE,
      provisionalTrustPosture: TrustPosture.MODERATE,
      riskHypotheses: [],
      assessedBy: actor.id,
    });

    const history = await getObjectHistory(
      TrackedObjectType.TRUST_ASSESSMENT_OBJECT,
      assessment.id
    );

    expect(history).toHaveLength(1);
    expect(history[0].actorName).toBe(actor.name);
    expect(history[0].reason).toBe("Initial trust assessment");
    expect(history[0].changedFields.certificationsClaimed).toBeDefined();
    expect(typeof history[0].createdAt).toBe("string");
    // ISO string check
    expect(() => new Date(history[0].createdAt)).not.toThrow();
  });

  it("returns entries newest-first after multiple mutations", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const assessment = await createTrustAssessment(audit.id, {
      certificationsClaimed: [],
      regulatoryClaims: [],
      compliancePosture: CompliancePosture.ADEQUATE,
      maturityPosture: MaturityPosture.MATURE,
      provisionalTrustPosture: TrustPosture.MODERATE,
      riskHypotheses: [],
      assessedBy: actor.id,
    });

    await updateTrustAssessment(assessment.id, {
      values: { provisionalTrustPosture: TrustPosture.LOW },
      actorId: actor.id,
      reason: "Escalation after findings review",
    });

    const history = await getObjectHistory(
      TrackedObjectType.TRUST_ASSESSMENT_OBJECT,
      assessment.id
    );

    expect(history).toHaveLength(2);
    // Newest first — the update should be at index 0
    expect(history[0].reason).toBe("Escalation after findings review");
    expect(history[1].reason).toBe("Initial trust assessment");
  });

  it("includes actor name in each entry", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const assessment = await createTrustAssessment(audit.id, {
      certificationsClaimed: [],
      regulatoryClaims: [],
      compliancePosture: CompliancePosture.ADEQUATE,
      maturityPosture: MaturityPosture.MATURE,
      provisionalTrustPosture: TrustPosture.MODERATE,
      riskHypotheses: [],
      assessedBy: actor.id,
    });

    const history = await getObjectHistory(
      TrackedObjectType.TRUST_ASSESSMENT_OBJECT,
      assessment.id
    );

    expect(history[0].actorName).toBe(actor.name);
  });

  it("does not return deltas from a different object with the same type", async () => {
    const { audit: auditA, actor } = await seedAuditWithContext();
    const { audit: auditB } = await seedAuditWithContext();

    const assessmentA = await createTrustAssessment(auditA.id, {
      certificationsClaimed: [],
      regulatoryClaims: [],
      compliancePosture: CompliancePosture.ADEQUATE,
      maturityPosture: MaturityPosture.MATURE,
      provisionalTrustPosture: TrustPosture.MODERATE,
      riskHypotheses: [],
      assessedBy: actor.id,
    });

    await createTrustAssessment(auditB.id, {
      certificationsClaimed: [],
      regulatoryClaims: [],
      compliancePosture: CompliancePosture.ADEQUATE,
      maturityPosture: MaturityPosture.MATURE,
      provisionalTrustPosture: TrustPosture.MODERATE,
      riskHypotheses: [],
      assessedBy: actor.id,
    });

    const history = await getObjectHistory(
      TrackedObjectType.TRUST_ASSESSMENT_OBJECT,
      assessmentA.id
    );

    expect(history).toHaveLength(1);
  });
});
