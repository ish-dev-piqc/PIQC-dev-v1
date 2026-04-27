// =============================================================================
// Tests: lib/questionnaires.ts
//
// Covers the full questionnaire lifecycle:
//   createQuestionnaireInstance  — fork from template, delta, idempotency guard
//   captureResponse              — single-response write, delta, no-op skip
//   captureVendorReturn          — batch ingest, fail-fast validation, shared timestamp
//   generateAddenda              — rule-table execution, incremental + replace modes
//   transitionInstanceStatus     — linear lifecycle, timestamp stamps, invalid guard
//   getRenderedQuestionnaire     — read shape, null response handling
//   exportQuestionnaireMarkdown  — markdown serializer, header, sections, response blocks
//
// Design: integration tests against a real Postgres test DB.
// Setup of prerequisite artifacts uses direct prisma.create (state-shortcut pattern)
// so each test focuses on the function under test, not on upstream flows.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  DerivedCriticality,
  QuestionnaireInstanceStatus,
  QuestionOrigin,
  ResponseSource,
  ResponseStatus,
  TrackedObjectType,
} from "@prisma/client";
import {
  captureResponse,
  captureVendorReturn,
  createQuestionnaireInstance,
  exportQuestionnaireMarkdown,
  generateAddenda,
  getRenderedQuestionnaire,
  transitionInstanceStatus,
} from "@/lib/questionnaires";
import { prisma } from "@/lib/prisma";
import {
  createProtocolRiskObject,
  seedAuditWithContext,
  seedAuditWithVendorService,
  seedDefaultTemplate,
  seedInstanceWithQuestion,
  seedMappingForAudit,
  seedQuestionnaireInstance,
} from "../helpers/factory";

// =============================================================================
// createQuestionnaireInstance
// =============================================================================

describe("createQuestionnaireInstance", () => {
  it("creates an instance with DRAFT status for the given audit", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const { version } = await seedDefaultTemplate();

    const instance = await createQuestionnaireInstance({
      auditId: audit.id,
      actorId: actor.id,
    });

    expect(instance.auditId).toBe(audit.id);
    expect(instance.status).toBe(QuestionnaireInstanceStatus.DRAFT);
    expect(instance.templateVersionId).toBe(version.id);
  });

  it("pre-creates a PENDING response row for each template question", async () => {
    const { audit, actor } = await seedAuditWithContext();
    await seedDefaultTemplate({
      questions: [
        { questionNumber: "1.1.1", sectionCode: "1.1", sectionTitle: "Background", prompt: "Q1", ordinal: 1 },
        { questionNumber: "1.1.2", sectionCode: "1.1", sectionTitle: "Background", prompt: "Q2", ordinal: 2 },
        { questionNumber: "2.1.1", sectionCode: "2.1", sectionTitle: "QMS",        prompt: "Q3", ordinal: 3 },
      ],
    });

    const instance = await createQuestionnaireInstance({
      auditId: audit.id,
      actorId: actor.id,
    });

    const rows = await prisma.questionnaireResponseObject.findMany({
      where: { instanceId: instance.id },
    });

    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source === ResponseSource.PENDING)).toBe(true);
    expect(rows.every((r) => r.responseStatus === ResponseStatus.UNANSWERED)).toBe(true);
  });

  it("writes a creation delta on QUESTIONNAIRE_INSTANCE", async () => {
    const { audit, actor } = await seedAuditWithContext();
    await seedDefaultTemplate();

    const instance = await createQuestionnaireInstance({
      auditId: audit.id,
      actorId: actor.id,
    });

    const deltas = await prisma.stateHistoryDelta.findMany({
      where: { objectType: TrackedObjectType.QUESTIONNAIRE_INSTANCE, objectId: instance.id },
    });

    expect(deltas).toHaveLength(1);
    expect(deltas[0].actorId).toBe(actor.id);
    expect(deltas[0].reason).toMatch(/created/i);
  });

  it("throws if an instance already exists for the audit", async () => {
    const { audit, actor } = await seedAuditWithContext();
    await seedDefaultTemplate();

    await createQuestionnaireInstance({ auditId: audit.id, actorId: actor.id });

    await expect(
      createQuestionnaireInstance({ auditId: audit.id, actorId: actor.id })
    ).rejects.toThrow(/already exists/i);
  });

  it("throws if no default template exists and no slug is provided", async () => {
    const { audit, actor } = await seedAuditWithContext();
    // No template seeded in this test — default template absent

    await expect(
      createQuestionnaireInstance({ auditId: audit.id, actorId: actor.id })
    ).rejects.toThrow(/no default.*template/i);
  });
});

// =============================================================================
// captureResponse
// =============================================================================

describe("captureResponse", () => {
  it("updates responseText and source on the response row", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const { instance, question } = await seedInstanceWithQuestion(audit.id);

    const updated = await captureResponse({
      instanceId: instance.id,
      questionId: question.id,
      actorId: actor.id,
      source: ResponseSource.AUDITOR_PREFILL_WEB,
      responseText: "ISO 9001:2015 certified since 2018.",
      sourceReference: "https://example-vendor.com/quality",
    });

    expect(updated.responseText).toBe("ISO 9001:2015 certified since 2018.");
    expect(updated.source).toBe(ResponseSource.AUDITOR_PREFILL_WEB);
    expect(updated.sourceReference).toBe("https://example-vendor.com/quality");
  });

  it("sets respondedAt when responseText is provided", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const { instance, question } = await seedInstanceWithQuestion(audit.id);

    const before = new Date();
    const updated = await captureResponse({
      instanceId: instance.id,
      questionId: question.id,
      actorId: actor.id,
      source: ResponseSource.AUDITOR_AUTHORED,
      responseText: "Confirmed.",
    });
    const after = new Date();

    expect(updated.respondedAt).not.toBeNull();
    expect(updated.respondedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updated.respondedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("writes a delta on QUESTIONNAIRE_RESPONSE_OBJECT", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const { instance, question, response } = await seedInstanceWithQuestion(audit.id);

    await captureResponse({
      instanceId: instance.id,
      questionId: question.id,
      actorId: actor.id,
      source: ResponseSource.VENDOR,
      responseText: "Vendor response text.",
    });

    const deltas = await prisma.stateHistoryDelta.findMany({
      where: { objectType: TrackedObjectType.QUESTIONNAIRE_RESPONSE_OBJECT, objectId: response.id },
    });

    expect(deltas).toHaveLength(1);
    expect(deltas[0].actorId).toBe(actor.id);
    const fields = deltas[0].changedFields as Record<string, unknown>;
    expect(fields).toHaveProperty("source");
    expect(fields).toHaveProperty("responseText");
  });

  it("does not write a delta when nothing changed", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const { instance, question, response } = await seedInstanceWithQuestion(audit.id);

    // First write — establishes a non-PENDING state with responseText
    await captureResponse({
      instanceId: instance.id,
      questionId: question.id,
      actorId: actor.id,
      source: ResponseSource.AUDITOR_AUTHORED,
      responseText: "Established text.",
    });

    const countBefore = await prisma.stateHistoryDelta.count({
      where: { objectType: TrackedObjectType.QUESTIONNAIRE_RESPONSE_OBJECT, objectId: response.id },
    });

    // Second write: same source, no responseText — respondedAt falls through to
    // existing.respondedAt (unchanged), so diffFields produces an empty object → no delta.
    await captureResponse({
      instanceId: instance.id,
      questionId: question.id,
      actorId: actor.id,
      source: ResponseSource.AUDITOR_AUTHORED,
      // responseText intentionally omitted — falls back to existing.responseText
    });

    const countAfter = await prisma.stateHistoryDelta.count({
      where: { objectType: TrackedObjectType.QUESTIONNAIRE_RESPONSE_OBJECT, objectId: response.id },
    });

    expect(countAfter).toBe(countBefore);
  });

  it("throws if the response row does not exist", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const { instance } = await seedInstanceWithQuestion(audit.id);
    const nonExistentQuestionId = "00000000-0000-0000-0000-000000000000";

    await expect(
      captureResponse({
        instanceId: instance.id,
        questionId: nonExistentQuestionId,
        actorId: actor.id,
        source: ResponseSource.AUDITOR_AUTHORED,
        responseText: "Will not land.",
      })
    ).rejects.toThrow();
  });
});

// =============================================================================
// captureVendorReturn
// =============================================================================

describe("captureVendorReturn", () => {
  // Helper: seed an instance with N response rows (one per fabricated question).
  // Counter-based slug mirrors the factory `unique()` pattern — safe under
  // rapid sequential execution where Date.now() could repeat.
  let cvrCounter = 0;
  async function seedInstanceWithNResponses(auditId: string, n: number) {
    const slug = `tpl-cvr-${Date.now()}-${++cvrCounter}`;
    const template = await prisma.questionnaireTemplate.create({
      data: { slug, name: `Template CVR ${cvrCounter}` },
    });
    const version = await prisma.questionnaireTemplateVersion.create({
      data: { templateId: template.id, versionNumber: 1 },
    });
    const instance = await prisma.questionnaireInstance.create({
      data: {
        auditId,
        templateVersionId: version.id,
        status: QuestionnaireInstanceStatus.SENT_TO_VENDOR,
      },
    });
    const questions = [];
    const responses = [];
    for (let i = 1; i <= n; i++) {
      const q = await prisma.questionnaireQuestion.create({
        data: {
          origin: QuestionOrigin.TEMPLATE,
          templateVersionId: version.id,
          questionNumber: `1.1.${i}`,
          sectionCode: "1.1",
          sectionTitle: "Test Section",
          prompt: `Question ${i}?`,
          answerType: "NARRATIVE",
          evidenceExpected: false,
          ordinal: i,
        },
      });
      const r = await prisma.questionnaireResponseObject.create({
        data: {
          instanceId: instance.id,
          questionId: q.id,
          auditId,
          source: ResponseSource.PENDING,
          responseStatus: ResponseStatus.UNANSWERED,
        },
      });
      questions.push(q);
      responses.push(r);
    }
    return { instance, questions, responses };
  }

  it("marks all responses as VENDOR-sourced with the provided responseText", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const { instance, questions } = await seedInstanceWithNResponses(audit.id, 2);

    await captureVendorReturn({
      instanceId: instance.id,
      actorId: actor.id,
      responses: [
        { questionId: questions[0].id, responseText: "Vendor answer A." },
        { questionId: questions[1].id, responseText: "Vendor answer B." },
      ],
    });

    const rows = await prisma.questionnaireResponseObject.findMany({
      where: { instanceId: instance.id },
      orderBy: { createdAt: "asc" },
    });

    expect(rows[0].source).toBe(ResponseSource.VENDOR);
    expect(rows[0].responseText).toBe("Vendor answer A.");
    expect(rows[1].source).toBe(ResponseSource.VENDOR);
    expect(rows[1].responseText).toBe("Vendor answer B.");
  });

  it("transitions the instance status to VENDOR_RESPONDED", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const { instance, questions } = await seedInstanceWithNResponses(audit.id, 1);

    await captureVendorReturn({
      instanceId: instance.id,
      actorId: actor.id,
      responses: [{ questionId: questions[0].id, responseText: "Answered." }],
    });

    const updated = await prisma.questionnaireInstance.findUniqueOrThrow({
      where: { id: instance.id },
    });

    expect(updated.status).toBe(QuestionnaireInstanceStatus.VENDOR_RESPONDED);
    expect(updated.vendorRespondedAt).not.toBeNull();
  });

  it("all responses in a bulk return share the same respondedAt timestamp", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const { instance, questions } = await seedInstanceWithNResponses(audit.id, 3);

    await captureVendorReturn({
      instanceId: instance.id,
      actorId: actor.id,
      responses: questions.map((q, i) => ({
        questionId: q.id,
        responseText: `Answer ${i + 1}`,
      })),
    });

    const rows = await prisma.questionnaireResponseObject.findMany({
      where: { instanceId: instance.id },
    });

    const timestamps = rows.map((r) => r.respondedAt?.toISOString());
    expect(new Set(timestamps).size).toBe(1); // All identical
    expect(timestamps[0]).toBeDefined();
  });

  it("writes a delta on QUESTIONNAIRE_INSTANCE for the status change", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const { instance, questions } = await seedInstanceWithNResponses(audit.id, 1);

    await captureVendorReturn({
      instanceId: instance.id,
      actorId: actor.id,
      responses: [{ questionId: questions[0].id, responseText: "Replied." }],
    });

    const instanceDelta = await prisma.stateHistoryDelta.findFirst({
      where: {
        objectType: TrackedObjectType.QUESTIONNAIRE_INSTANCE,
        objectId: instance.id,
      },
    });

    expect(instanceDelta).not.toBeNull();
    expect(instanceDelta!.reason).toMatch(/vendor return ingested/i);
    const fields = instanceDelta!.changedFields as Record<string, { from: string; to: string }>;
    expect(fields.status?.to).toBe(QuestionnaireInstanceStatus.VENDOR_RESPONDED);
  });

  it("throws fail-fast if any questionId is missing, without writing any response", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const { instance, questions, responses } = await seedInstanceWithNResponses(audit.id, 1);
    const bogusQuestionId = "00000000-0000-0000-0000-000000000099";

    await expect(
      captureVendorReturn({
        instanceId: instance.id,
        actorId: actor.id,
        responses: [
          { questionId: questions[0].id,  responseText: "Valid answer." },
          { questionId: bogusQuestionId,  responseText: "Should not land." },
        ],
      })
    ).rejects.toThrow(/not found/i);

    // Verify the valid response row was NOT written (transaction rolled back)
    const row = await prisma.questionnaireResponseObject.findUniqueOrThrow({
      where: { id: responses[0].id },
    });
    expect(row.source).toBe(ResponseSource.PENDING);
  });
});

// =============================================================================
// generateAddenda
// =============================================================================

describe("generateAddenda", () => {
  // For these tests we need: audit + vendor service (central_lab) + protocol risk
  // object + mapping + questionnaire instance. The rule table has base rules for
  // central_lab (no phase/criticality restriction) that will always fire.
  async function setupAddendaContext() {
    const ctx = await seedAuditWithVendorService({ serviceType: "central_lab" });
    const riskObj = await createProtocolRiskObject(ctx.protocolVersion.id, ctx.actor.id, {
      operationalDomainTag: "central_lab",
    });
    const mapping = await seedMappingForAudit(ctx.vendorService.id, riskObj.id, {
      criticality: DerivedCriticality.HIGH,
    });
    const instance = await seedQuestionnaireInstance(ctx.audit.id);
    return { ...ctx, riskObj, mapping, instance };
  }

  it("throws if the audit has no vendor service defined", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const instance = await seedQuestionnaireInstance(audit.id);

    await expect(
      generateAddenda({ instanceId: instance.id, actorId: actor.id })
    ).rejects.toThrow(/no.*vendor service/i);
  });

  it("creates addendum questions for all matching rules in incremental mode", async () => {
    const { actor, instance } = await setupAddendaContext();

    const result = await generateAddenda({
      instanceId: instance.id,
      actorId: actor.id,
    });

    // central_lab has ≥2 base rules (sample_chain_of_custody + assay_validation)
    // plus subcontractor_oversight at HIGH criticality — expect at least 2
    expect(result.createdCount).toBeGreaterThanOrEqual(2);

    const addendaRows = await prisma.questionnaireQuestion.findMany({
      where: { instanceId: instance.id, origin: QuestionOrigin.ADDENDUM },
    });
    expect(addendaRows).toHaveLength(result.createdCount);

    // Each addendum question should have a PENDING response row
    const responseRows = await prisma.questionnaireResponseObject.findMany({
      where: {
        instanceId: instance.id,
        questionId: { in: addendaRows.map((q) => q.id) },
      },
    });
    expect(responseRows).toHaveLength(result.createdCount);
    expect(responseRows.every((r) => r.source === ResponseSource.PENDING)).toBe(true);

    // generateAddenda writes a QUESTIONNAIRE_INSTANCE delta listing the created question numbers
    const delta = await prisma.stateHistoryDelta.findFirst({
      where: {
        objectType: TrackedObjectType.QUESTIONNAIRE_INSTANCE,
        objectId: instance.id,
      },
    });
    expect(delta).not.toBeNull();
    const fields = delta!.changedFields as Record<string, { from: unknown; to: unknown }>;
    expect(fields).toHaveProperty("addendaGenerated");
    expect(Array.isArray(fields.addendaGenerated.to)).toBe(true);
  });

  it("does not duplicate questions on a second incremental call", async () => {
    const { actor, instance } = await setupAddendaContext();

    const first = await generateAddenda({ instanceId: instance.id, actorId: actor.id });
    expect(first.createdCount).toBeGreaterThan(0);

    // Second call in incremental mode — all questions already exist for this mapping
    const second = await generateAddenda({ instanceId: instance.id, actorId: actor.id });
    expect(second.createdCount).toBe(0);

    const total = await prisma.questionnaireQuestion.count({
      where: { instanceId: instance.id, origin: QuestionOrigin.ADDENDUM },
    });
    expect(total).toBe(first.createdCount);
  });

  it("wipes and regenerates all addendum questions in replace mode", async () => {
    const { actor, instance } = await setupAddendaContext();

    const first = await generateAddenda({ instanceId: instance.id, actorId: actor.id });
    expect(first.createdCount).toBeGreaterThan(0);

    const replace = await generateAddenda({
      instanceId: instance.id,
      actorId: actor.id,
      replaceExisting: true,
    });

    // Should regenerate the same count — same mapping + service type
    expect(replace.createdCount).toBe(first.createdCount);

    const total = await prisma.questionnaireQuestion.count({
      where: { instanceId: instance.id, origin: QuestionOrigin.ADDENDUM },
    });
    expect(total).toBe(replace.createdCount); // Old rows deleted, new rows created
  });
});

// =============================================================================
// transitionInstanceStatus
// =============================================================================

describe("transitionInstanceStatus", () => {
  it("advances DRAFT to PREFILL_IN_PROGRESS", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const instance = await seedQuestionnaireInstance(audit.id, {
      status: QuestionnaireInstanceStatus.DRAFT,
    });

    const updated = await transitionInstanceStatus({
      instanceId: instance.id,
      actorId: actor.id,
      toStatus: QuestionnaireInstanceStatus.PREFILL_IN_PROGRESS,
    });

    expect(updated.status).toBe(QuestionnaireInstanceStatus.PREFILL_IN_PROGRESS);
  });

  it("sets sentToVendorAt when transitioning to SENT_TO_VENDOR", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const instance = await seedQuestionnaireInstance(audit.id, {
      status: QuestionnaireInstanceStatus.READY_TO_SEND,
    });

    const before = new Date();
    const updated = await transitionInstanceStatus({
      instanceId: instance.id,
      actorId: actor.id,
      toStatus: QuestionnaireInstanceStatus.SENT_TO_VENDOR,
    });

    expect(updated.sentToVendorAt).not.toBeNull();
    expect(updated.sentToVendorAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("sets completedAt when transitioning to COMPLETE", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const instance = await seedQuestionnaireInstance(audit.id, {
      status: QuestionnaireInstanceStatus.VENDOR_RESPONDED,
    });

    const before = new Date();
    const updated = await transitionInstanceStatus({
      instanceId: instance.id,
      actorId: actor.id,
      toStatus: QuestionnaireInstanceStatus.COMPLETE,
    });

    expect(updated.completedAt).not.toBeNull();
    expect(updated.completedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updated.status).toBe(QuestionnaireInstanceStatus.COMPLETE);
  });

  it("throws on an invalid transition (backward jump)", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const instance = await seedQuestionnaireInstance(audit.id, {
      status: QuestionnaireInstanceStatus.PREFILL_IN_PROGRESS,
    });

    await expect(
      transitionInstanceStatus({
        instanceId: instance.id,
        actorId: actor.id,
        toStatus: QuestionnaireInstanceStatus.COMPLETE,
      })
    ).rejects.toThrow(/invalid status transition/i);
  });

  it("writes a status delta on each transition", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const instance = await seedQuestionnaireInstance(audit.id, {
      status: QuestionnaireInstanceStatus.DRAFT,
    });

    await transitionInstanceStatus({
      instanceId: instance.id,
      actorId: actor.id,
      toStatus: QuestionnaireInstanceStatus.PREFILL_IN_PROGRESS,
      reason: "Auditor starting pre-fill",
    });

    const delta = await prisma.stateHistoryDelta.findFirst({
      where: {
        objectType: TrackedObjectType.QUESTIONNAIRE_INSTANCE,
        objectId: instance.id,
      },
    });

    expect(delta).not.toBeNull();
    expect(delta!.reason).toBe("Auditor starting pre-fill");
    const fields = delta!.changedFields as Record<string, { from: string; to: string }>;
    expect(fields.status?.from).toBe(QuestionnaireInstanceStatus.DRAFT);
    expect(fields.status?.to).toBe(QuestionnaireInstanceStatus.PREFILL_IN_PROGRESS);
  });
});

// =============================================================================
// getRenderedQuestionnaire
// =============================================================================

describe("getRenderedQuestionnaire", () => {
  it("throws if the instance does not exist", async () => {
    const nonExistentId = "00000000-0000-0000-0000-000000000000";
    await expect(getRenderedQuestionnaire(nonExistentId)).rejects.toThrow();
  });

  it("returns the instance and rendered questions with their response shape", async () => {
    const { audit } = await seedAuditWithContext();
    const { instance, question, response } = await seedInstanceWithQuestion(audit.id);

    const { instance: renderedInstance, questions } = await getRenderedQuestionnaire(instance.id);

    expect(renderedInstance.id).toBe(instance.id);
    expect(questions).toHaveLength(1);

    const q = questions[0];
    expect(q.id).toBe(question.id);
    expect(q.prompt).toBe("Describe your quality management system.");
    expect(q.response).not.toBeNull();
    expect(q.response!.id).toBe(response.id);
    expect(q.response!.source).toBe(ResponseSource.PENDING);
  });

  it("sets response to null for a question that has no response row", async () => {
    const { audit } = await seedAuditWithContext();
    // Create an instance + template version, then an addendum question with no response row
    const { instance } = await seedInstanceWithQuestion(audit.id);

    await prisma.questionnaireQuestion.create({
      data: {
        origin: QuestionOrigin.ADDENDUM,
        instanceId: instance.id,
        questionNumber: "5.3.1",
        sectionCode: "5.3",
        sectionTitle: "Service-Specific Addenda",
        prompt: "No response row for this one.",
        answerType: "NARRATIVE",
        evidenceExpected: false,
        ordinal: 99,
      },
    });

    const { questions } = await getRenderedQuestionnaire(instance.id);

    const addendumQ = questions.find((q) => q.questionNumber === "5.3.1");
    expect(addendumQ).toBeDefined();
    expect(addendumQ!.response).toBeNull();
  });
});

// =============================================================================
// exportQuestionnaireMarkdown
// =============================================================================

describe("exportQuestionnaireMarkdown", () => {
  it("includes the instance status in the header block", async () => {
    const { audit } = await seedAuditWithContext();
    const { instance } = await seedInstanceWithQuestion(audit.id);

    const md = await exportQuestionnaireMarkdown(instance.id);

    expect(md).toContain("# Standard GCP Vendor Questionnaire");
    expect(md).toContain("**Status:**");
    expect(md).toContain("Draft"); // DRAFT → _fmtInstanceStatus → "Draft"
  });

  it("groups questions under their section heading", async () => {
    const { audit } = await seedAuditWithContext();
    const { instance } = await seedInstanceWithQuestion(audit.id);

    const md = await exportQuestionnaireMarkdown(instance.id);

    expect(md).toContain("## Section 1.1 — Vendor Background");
    expect(md).toContain("Describe your quality management system.");
  });

  it("renders pending responses as the pending placeholder text", async () => {
    const { audit } = await seedAuditWithContext();
    const { instance } = await seedInstanceWithQuestion(audit.id);
    // Response row exists but source is PENDING — should render placeholder

    const md = await exportQuestionnaireMarkdown(instance.id);

    expect(md).toContain("_(Pending — no response captured)_");
  });

  it("renders an answered response as a blockquote with source attribution", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const { instance, question } = await seedInstanceWithQuestion(audit.id);

    await captureResponse({
      instanceId: instance.id,
      questionId: question.id,
      actorId: actor.id,
      source: ResponseSource.AUDITOR_PREFILL_WEB,
      responseText: "Our QMS is ISO 9001:2015 certified.",
      sourceReference: "https://example.com/qms",
    });

    const md = await exportQuestionnaireMarkdown(instance.id);

    // Response text wrapped in a blockquote
    expect(md).toContain("> Our QMS is ISO 9001:2015 certified.");
    // Source attribution line
    expect(md).toContain("Source: Web research — https://example.com/qms");
  });
});
