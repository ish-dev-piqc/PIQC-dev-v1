// =============================================================================
// Tests: lib/audit-stage.ts
//
// Highest-leverage surface to test:
//   - linear progression rule (forward exactly +1; backward any distance)
//   - the two gates (PRE_AUDIT_DRAFTING, AUDIT_CONDUCT)
//   - readout exposes correct deliverable approval state
//
// Every gate path is exercised so the next person who adds a gate has a
// regression net for the existing ones.
// =============================================================================

import { describe, expect, it } from "vitest";
import { AuditStage } from "@prisma/client";
import {
  StageTransitionError,
  getStageReadout,
  transitionAuditStage,
} from "@/lib/audit-stage";
import { prisma } from "@/lib/prisma";
import {
  seedAuditWithContext,
  seedDeliverable,
  seedQuestionnaireInstance,
  seedRiskSummary,
} from "../helpers/factory";

describe("transitionAuditStage — linear progression", () => {
  it("advances forward by exactly one stage", async () => {
    const { audit, actor } = await seedAuditWithContext({ stage: AuditStage.INTAKE });

    const updated = await transitionAuditStage({
      auditId: audit.id,
      toStage: AuditStage.VENDOR_ENRICHMENT,
      actorId: actor.id,
    });

    expect(updated.currentStage).toBe(AuditStage.VENDOR_ENRICHMENT);
  });

  it("rejects forward jumps greater than one", async () => {
    const { audit, actor } = await seedAuditWithContext({ stage: AuditStage.INTAKE });

    await expect(
      transitionAuditStage({
        auditId: audit.id,
        toStage: AuditStage.QUESTIONNAIRE_REVIEW,
        actorId: actor.id,
      })
    ).rejects.toMatchObject({ code: "INVALID_FORWARD_JUMP" });
  });

  it("allows backward transitions of any distance, ungated", async () => {
    const { audit, actor } = await seedAuditWithContext({
      stage: AuditStage.PRE_AUDIT_DRAFTING,
    });

    const updated = await transitionAuditStage({
      auditId: audit.id,
      toStage: AuditStage.INTAKE,
      actorId: actor.id,
    });

    expect(updated.currentStage).toBe(AuditStage.INTAKE);
  });

  it("rejects same-stage transitions", async () => {
    const { audit, actor } = await seedAuditWithContext({ stage: AuditStage.INTAKE });

    await expect(
      transitionAuditStage({
        auditId: audit.id,
        toStage: AuditStage.INTAKE,
        actorId: actor.id,
      })
    ).rejects.toMatchObject({ code: "ALREADY_AT_STAGE" });
  });

  it("returns AUDIT_NOT_FOUND for unknown audit", async () => {
    const { actor } = await seedAuditWithContext();
    await expect(
      transitionAuditStage({
        auditId: "00000000-0000-0000-0000-000000000000",
        toStage: AuditStage.VENDOR_ENRICHMENT,
        actorId: actor.id,
      })
    ).rejects.toMatchObject({ code: "AUDIT_NOT_FOUND" });
  });

  it("writes a state-history delta for the transition", async () => {
    const { audit, actor } = await seedAuditWithContext({ stage: AuditStage.INTAKE });

    await transitionAuditStage({
      auditId: audit.id,
      toStage: AuditStage.VENDOR_ENRICHMENT,
      actorId: actor.id,
      reason: "Ready to enrich",
    });

    const deltas = await prisma.stateHistoryDelta.findMany({
      where: { objectType: "AUDIT", objectId: audit.id },
    });
    expect(deltas).toHaveLength(1);
    expect(deltas[0].reason).toBe("Ready to enrich");
  });
});

describe("transitionAuditStage — PRE_AUDIT_DRAFTING gate", () => {
  it("blocks if questionnaire is not approved", async () => {
    const { audit, actor } = await seedAuditWithContext({
      stage: AuditStage.SCOPE_AND_RISK_REVIEW,
    });
    // No questionnaire, no risk summary → first failure is questionnaire.
    await expect(
      transitionAuditStage({
        auditId: audit.id,
        toStage: AuditStage.PRE_AUDIT_DRAFTING,
        actorId: actor.id,
      })
    ).rejects.toMatchObject({ code: "GATE_QUESTIONNAIRE_NOT_APPROVED" });
  });

  it("blocks if questionnaire is approved but risk summary is not", async () => {
    const { audit, actor } = await seedAuditWithContext({
      stage: AuditStage.SCOPE_AND_RISK_REVIEW,
    });
    await seedQuestionnaireInstance(audit.id, { approved: true, approvedBy: actor.id });

    await expect(
      transitionAuditStage({
        auditId: audit.id,
        toStage: AuditStage.PRE_AUDIT_DRAFTING,
        actorId: actor.id,
      })
    ).rejects.toMatchObject({ code: "GATE_RISK_SUMMARY_NOT_APPROVED" });
  });

  it("opens once both questionnaire and risk summary are approved", async () => {
    const { audit, actor } = await seedAuditWithContext({
      stage: AuditStage.SCOPE_AND_RISK_REVIEW,
    });
    await seedQuestionnaireInstance(audit.id, { approved: true, approvedBy: actor.id });
    await seedRiskSummary(audit.id, { approved: true, approvedBy: actor.id });

    const updated = await transitionAuditStage({
      auditId: audit.id,
      toStage: AuditStage.PRE_AUDIT_DRAFTING,
      actorId: actor.id,
    });

    expect(updated.currentStage).toBe(AuditStage.PRE_AUDIT_DRAFTING);
  });
});

describe("transitionAuditStage — AUDIT_CONDUCT gate", () => {
  async function setupApprovedUpstream(stage: AuditStage = AuditStage.PRE_AUDIT_DRAFTING) {
    const ctx = await seedAuditWithContext({ stage });
    await seedQuestionnaireInstance(ctx.audit.id, { approved: true, approvedBy: ctx.actor.id });
    await seedRiskSummary(ctx.audit.id, { approved: true, approvedBy: ctx.actor.id });
    return ctx;
  }

  it("blocks if no deliverables exist", async () => {
    const { audit, actor } = await setupApprovedUpstream();
    await expect(
      transitionAuditStage({
        auditId: audit.id,
        toStage: AuditStage.AUDIT_CONDUCT,
        actorId: actor.id,
      })
    ).rejects.toMatchObject({ code: "GATE_DELIVERABLES_NOT_APPROVED" });
  });

  it("blocks if any single deliverable is unapproved", async () => {
    const { audit, actor } = await setupApprovedUpstream();
    await seedDeliverable(audit.id, "confirmationLetter", { approved: true, approvedBy: actor.id });
    await seedDeliverable(audit.id, "agenda",             { approved: true, approvedBy: actor.id });
    // Checklist seeded but NOT approved.
    await seedDeliverable(audit.id, "checklist", { approved: false });

    const err = await transitionAuditStage({
      auditId: audit.id,
      toStage: AuditStage.AUDIT_CONDUCT,
      actorId: actor.id,
    }).catch((e) => e as StageTransitionError);

    expect(err.code).toBe("GATE_DELIVERABLES_NOT_APPROVED");
    expect(err.message).toContain("checklist");
  });

  it("opens once all three deliverables are approved", async () => {
    const { audit, actor } = await setupApprovedUpstream();
    await seedDeliverable(audit.id, "confirmationLetter", { approved: true, approvedBy: actor.id });
    await seedDeliverable(audit.id, "agenda",             { approved: true, approvedBy: actor.id });
    await seedDeliverable(audit.id, "checklist",          { approved: true, approvedBy: actor.id });

    const updated = await transitionAuditStage({
      auditId: audit.id,
      toStage: AuditStage.AUDIT_CONDUCT,
      actorId: actor.id,
    });

    expect(updated.currentStage).toBe(AuditStage.AUDIT_CONDUCT);
  });
});

describe("getStageReadout", () => {
  it("returns null for an unknown audit", async () => {
    const readout = await getStageReadout("00000000-0000-0000-0000-000000000000");
    expect(readout).toBeNull();
  });

  it("reports per-deliverable approval state", async () => {
    const { audit, actor } = await seedAuditWithContext({
      stage: AuditStage.PRE_AUDIT_DRAFTING,
    });
    await seedDeliverable(audit.id, "confirmationLetter", { approved: true, approvedBy: actor.id });
    await seedDeliverable(audit.id, "agenda",             { approved: false });
    // Checklist: no row at all.

    const readout = await getStageReadout(audit.id);
    expect(readout?.deliverablesApproved).toEqual({
      confirmationLetter: true,
      agenda: false,
      checklist: false,
    });
  });

  it("surfaces the next-stage block reason when gated", async () => {
    const { audit } = await seedAuditWithContext({
      stage: AuditStage.SCOPE_AND_RISK_REVIEW,
    });
    // No questionnaire — next stage (PRE_AUDIT_DRAFTING) is blocked.

    const readout = await getStageReadout(audit.id);
    expect(readout?.canAdvance).toBe(false);
    expect(readout?.blockedReason).toMatch(/Questionnaire/i);
  });
});
