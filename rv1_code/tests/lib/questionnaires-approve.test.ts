// =============================================================================
// Tests: lib/questionnaires.ts → approveQuestionnaireInstance
//
// Covers only the approval gate (added in D-010). The wider questionnaire
// lifecycle (instance creation, addenda, response capture, vendor return) is
// out of scope for this initial test pass — those are pre-D-010 surfaces and
// can get their own dedicated test file.
// =============================================================================

import { describe, expect, it } from "vitest";
import { QuestionnaireInstanceStatus } from "@prisma/client";
import { approveQuestionnaireInstance } from "@/lib/questionnaires";
import { prisma } from "@/lib/prisma";
import { seedAuditWithContext, seedQuestionnaireInstance } from "../helpers/factory";

describe("approveQuestionnaireInstance", () => {
  it("refuses to approve when instance does not exist", async () => {
    const { audit, actor } = await seedAuditWithContext();
    await expect(
      approveQuestionnaireInstance({ auditId: audit.id, actorId: actor.id })
    ).rejects.toThrow(/not found/i);
  });

  it.each([
    QuestionnaireInstanceStatus.DRAFT,
    QuestionnaireInstanceStatus.PREFILL_IN_PROGRESS,
    QuestionnaireInstanceStatus.READY_TO_SEND,
    QuestionnaireInstanceStatus.SENT_TO_VENDOR,
    QuestionnaireInstanceStatus.VENDOR_RESPONDED,
  ])("refuses to approve when status is %s (not COMPLETE)", async (status) => {
    const { audit, actor } = await seedAuditWithContext();
    await seedQuestionnaireInstance(audit.id, { status });
    await expect(
      approveQuestionnaireInstance({ auditId: audit.id, actorId: actor.id })
    ).rejects.toThrow(/COMPLETE/i);
  });

  it("approves and stamps approvedAt/approvedBy when status is COMPLETE", async () => {
    const { audit, actor } = await seedAuditWithContext();
    await seedQuestionnaireInstance(audit.id, {
      status: QuestionnaireInstanceStatus.COMPLETE,
    });

    const approved = await approveQuestionnaireInstance({
      auditId: audit.id,
      actorId: actor.id,
    });

    expect(approved.approvedAt).toBeInstanceOf(Date);
    expect(approved.approvedBy).toBe(actor.id);
  });

  it("writes a state-history delta on approval", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const instance = await seedQuestionnaireInstance(audit.id, {
      status: QuestionnaireInstanceStatus.COMPLETE,
    });
    await approveQuestionnaireInstance({ auditId: audit.id, actorId: actor.id });

    const deltas = await prisma.stateHistoryDelta.findMany({
      where: { objectType: "QUESTIONNAIRE_INSTANCE", objectId: instance.id },
    });
    expect(deltas).toHaveLength(1);
    expect(deltas[0].actorId).toBe(actor.id);
  });
});
