// =============================================================================
// Test factories — minimal data to satisfy FK constraints.
//
// Each helper creates the smallest valid record. Compose them with the
// `seedAuditWithContext` umbrella when a test just needs "an audit existing".
// Individual helpers are exposed for tests that need to vary specific fields
// (e.g. multiple audits sharing a vendor).
// =============================================================================

import {
  AuditStage,
  AuditStatus,
  AuditType,
  ClinicalTrialPhase,
  DeliverableApprovalStatus,
  DerivedCriticality,
  EndpointTier,
  ImpactSurface,
  ProtocolVersionStatus,
  QuestionAnswerType,
  QuestionnaireInstanceStatus,
  QuestionOrigin,
  ResponseSource,
  ResponseStatus,
  RiskSummaryApprovalStatus,
  TaggingMode,
  UserRole,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DeliverableKind } from "@/lib/types/deliverables";

let counter = 0;
function unique(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

export async function createUser(overrides: { name?: string; role?: UserRole } = {}) {
  const id = unique();
  return prisma.user.create({
    data: {
      name: overrides.name ?? `User ${id}`,
      email: `user-${id}@example.com`,
      role: overrides.role ?? UserRole.LEAD_AUDITOR,
    },
  });
}

export async function createVendor(overrides: { name?: string } = {}) {
  return prisma.vendor.create({
    data: {
      name: overrides.name ?? `Vendor ${unique()}`,
      country: "US",
    },
  });
}

export async function createProtocolVersion(overrides: {
  studyNumber?: string;
  phase?: ClinicalTrialPhase;
  rawPiqcPayload?: unknown;
} = {}) {
  const protocol = await prisma.protocol.create({
    data: {
      studyNumber: overrides.studyNumber ?? `NCT-${unique()}`,
      title: `Test Study ${unique()}`,
      sponsor: "Test Sponsor",
    },
  });
  return prisma.protocolVersion.create({
    data: {
      protocolId: protocol.id,
      versionNumber: 1,
      status: ProtocolVersionStatus.ACTIVE,
      clinicalTrialPhase: overrides.phase ?? ClinicalTrialPhase.PHASE_3,
      rawPiqcPayload: (overrides.rawPiqcPayload as object | undefined) ?? {},
    },
  });
}

// Umbrella: User + Vendor + Protocol/Version + Audit. The most common test
// fixture — returns everything for follow-up assertions.
export async function seedAuditWithContext(opts: {
  stage?: AuditStage;
  status?: AuditStatus;
  scheduledDate?: Date;
} = {}) {
  const [actor, vendor, protocolVersion] = await Promise.all([
    createUser(),
    createVendor(),
    createProtocolVersion(),
  ]);
  const audit = await prisma.audit.create({
    data: {
      vendorId: vendor.id,
      protocolId: protocolVersion.protocolId,
      protocolVersionId: protocolVersion.id,
      auditName: `Test Audit ${unique()}`,
      auditType: AuditType.REMOTE,
      status: opts.status ?? AuditStatus.DRAFT,
      currentStage: opts.stage ?? AuditStage.INTAKE,
      leadAuditorId: actor.id,
      scheduledDate: opts.scheduledDate ?? new Date("2026-09-01"),
    },
  });
  return { actor, vendor, protocolVersion, audit };
}

// Convenience: seed an Audit + a vendor service so deliverable stub composers
// have something concrete to reference.
export async function seedAuditWithVendorService(opts: {
  stage?: AuditStage;
  serviceName?: string;
  serviceType?: string;
} = {}) {
  const ctx = await seedAuditWithContext({ stage: opts.stage });
  const vendorService = await prisma.vendorServiceObject.create({
    data: {
      auditId: ctx.audit.id,
      serviceName: opts.serviceName ?? "Central Lab",
      serviceType: opts.serviceType ?? "central_lab",
    },
  });
  return { ...ctx, vendorService };
}

// -----------------------------------------------------------------------------
// State-shortcut factories — bypass library lifecycles for setup speed.
//
// Tests covering library X use the real X functions for the operation under
// test; setup of *prerequisite* artifacts uses these direct-insert helpers.
// E.g. an audit-stage gate test for AUDIT_CONDUCT needs an approved risk
// summary + 3 approved deliverables — those are inserted as already-approved
// rows so the test focuses on the gate, not the approval flow.
// -----------------------------------------------------------------------------

export async function createProtocolRiskObject(
  protocolVersionId: string,
  actorId: string,
  overrides: {
    endpointTier?: EndpointTier;
    impactSurface?: ImpactSurface;
    timeSensitivity?: boolean;
    operationalDomainTag?: string;
  } = {}
) {
  return prisma.protocolRiskObject.create({
    data: {
      protocolVersionId,
      sectionIdentifier:   `§${unique()}`,
      sectionTitle:        `Section ${unique()}`,
      endpointTier:        overrides.endpointTier        ?? EndpointTier.PRIMARY,
      impactSurface:       overrides.impactSurface       ?? ImpactSurface.BOTH,
      timeSensitivity:     overrides.timeSensitivity     ?? false,
      operationalDomainTag: overrides.operationalDomainTag ?? "central_lab",
      vendorDependencyFlags: [],
      taggingMode:         TaggingMode.MANUAL,
      taggedBy:            actorId,
      taggedAt:            new Date(),
    },
  });
}

export async function seedQuestionnaireInstance(
  auditId: string,
  opts: { status?: QuestionnaireInstanceStatus; approved?: boolean; approvedBy?: string } = {}
) {
  const template = await prisma.questionnaireTemplate.create({
    data: { slug: `tpl-${unique()}`, name: `Template ${unique()}` },
  });
  const templateVersion = await prisma.questionnaireTemplateVersion.create({
    data: { templateId: template.id, versionNumber: 1 },
  });
  return prisma.questionnaireInstance.create({
    data: {
      auditId,
      templateVersionId: templateVersion.id,
      status: opts.status ?? QuestionnaireInstanceStatus.DRAFT,
      approvedAt: opts.approved ? new Date() : null,
      approvedBy: opts.approved ? (opts.approvedBy ?? null) : null,
    },
  });
}

export async function seedRiskSummary(
  auditId: string,
  opts: { approved?: boolean; approvedBy?: string; narrative?: string } = {}
) {
  return prisma.vendorRiskSummaryObject.create({
    data: {
      auditId,
      studyContext: {
        therapeuticSpace: "Oncology",
        primaryEndpoints: [],
        secondaryEndpoints: [],
        clinicalTrialPhase: "PHASE_3",
        capturedAt: new Date().toISOString(),
      },
      vendorRelevanceNarrative: opts.narrative ?? "Test narrative.",
      focusAreas: [],
      approvalStatus: opts.approved
        ? RiskSummaryApprovalStatus.APPROVED
        : RiskSummaryApprovalStatus.DRAFT,
      approvedAt: opts.approved ? new Date() : null,
      approvedBy: opts.approved ? (opts.approvedBy ?? null) : null,
    },
  });
}

export async function seedDeliverable(
  auditId: string,
  kind: DeliverableKind,
  opts: { approved?: boolean; approvedBy?: string } = {}
) {
  const data = {
    auditId,
    content: defaultContentFor(kind),
    approvalStatus: opts.approved
      ? DeliverableApprovalStatus.APPROVED
      : DeliverableApprovalStatus.DRAFT,
    approvedAt: opts.approved ? new Date() : null,
    approvedBy: opts.approved ? (opts.approvedBy ?? null) : null,
  };
  switch (kind) {
    case "confirmationLetter": return prisma.confirmationLetterObject.create({ data });
    case "agenda":              return prisma.agendaObject.create({ data });
    case "checklist":           return prisma.checklistObject.create({ data });
  }
}

// seedDefaultTemplate — creates a QuestionnaireTemplate with isDefault=true plus one
// TemplateVersion. Optionally seeds question rows so createQuestionnaireInstance can
// pre-create PENDING response rows. Used by tests that exercise the library's
// instance-creation path (which resolves the default template from the DB).
export async function seedDefaultTemplate(opts: {
  questions?: Array<{
    questionNumber: string;
    sectionCode: string;
    sectionTitle: string;
    prompt: string;
    ordinal: number;
    answerType?: QuestionAnswerType;
    evidenceExpected?: boolean;
  }>;
} = {}) {
  const template = await prisma.questionnaireTemplate.create({
    data: {
      slug: `default-${unique()}`,
      name: `Default Template ${unique()}`,
      isDefault: true,
    },
  });
  const version = await prisma.questionnaireTemplateVersion.create({
    data: { templateId: template.id, versionNumber: 1 },
  });
  if (opts.questions && opts.questions.length > 0) {
    await prisma.questionnaireQuestion.createMany({
      data: opts.questions.map((q) => ({
        origin: QuestionOrigin.TEMPLATE,
        templateVersionId: version.id,
        questionNumber: q.questionNumber,
        sectionCode: q.sectionCode,
        sectionTitle: q.sectionTitle,
        prompt: q.prompt,
        answerType: q.answerType ?? QuestionAnswerType.NARRATIVE,
        evidenceExpected: q.evidenceExpected ?? false,
        ordinal: q.ordinal,
      })),
    });
  }
  return { template, version };
}

// seedInstanceWithQuestion — bypasses createQuestionnaireInstance lifecycle.
// Creates template + version + instance + 1 TEMPLATE question + 1 PENDING response row.
// Use for tests that need an already-initialised instance (captureResponse, vendor return, etc.)
// without going through the full creation path.
export async function seedInstanceWithQuestion(auditId: string, opts: {
  status?: QuestionnaireInstanceStatus;
} = {}) {
  const template = await prisma.questionnaireTemplate.create({
    data: { slug: `tpl-${unique()}`, name: `Template ${unique()}` },
  });
  const version = await prisma.questionnaireTemplateVersion.create({
    data: { templateId: template.id, versionNumber: 1 },
  });
  const instance = await prisma.questionnaireInstance.create({
    data: {
      auditId,
      templateVersionId: version.id,
      status: opts.status ?? QuestionnaireInstanceStatus.DRAFT,
    },
  });
  const question = await prisma.questionnaireQuestion.create({
    data: {
      origin: QuestionOrigin.TEMPLATE,
      templateVersionId: version.id,
      questionNumber: "1.1.1",
      sectionCode: "1.1",
      sectionTitle: "Vendor Background",
      prompt: "Describe your quality management system.",
      answerType: QuestionAnswerType.NARRATIVE,
      evidenceExpected: false,
      ordinal: 1,
    },
  });
  const response = await prisma.questionnaireResponseObject.create({
    data: {
      instanceId: instance.id,
      questionId: question.id,
      auditId,
      source: ResponseSource.PENDING,
      responseStatus: ResponseStatus.UNANSWERED,
    },
  });
  return { template, version, instance, question, response };
}

// seedMappingForAudit — creates a VendorServiceMappingObject linking a vendor service
// to a protocol risk object. Used by generateAddenda tests which need at least one
// mapping for the rule table to produce addendum candidates.
export async function seedMappingForAudit(
  vendorServiceId: string,
  protocolRiskId: string,
  opts: { criticality?: DerivedCriticality } = {}
) {
  return prisma.vendorServiceMappingObject.create({
    data: {
      vendorServiceId,
      protocolRiskId,
      derivedCriticality: opts.criticality ?? DerivedCriticality.HIGH,
      criticalityRationale: "Test mapping",
    },
  });
}

function defaultContentFor(kind: DeliverableKind): object {
  switch (kind) {
    case "confirmationLetter":
      return {
        to: "Vendor",
        vendorContactTitle: "",
        vendorContactAddress: "",
        from: "Auditor",
        subject: "Audit",
        auditStartTime: "09:00",
        auditEndTime: "16:00",
        preAuditDocuments: [],
        bodyText: "Body",
        ccRecipients: [],
      };
    case "agenda":
      return {
        auditeeAddress: "",
        projects: "NCT-001",
        auditScope: "Central lab services",
        conductSummary: "Remote audit via video conference.",
        attendees: [],
        objectives: [],
        days: [{ date: null, label: "Day 1", items: [{ topic: "Kickoff" }] }],
      };
    case "checklist":
      return {
        auditContext: "Test",
        focusAreas: [],
        items: [{ id: "i1", prompt: "Verify QMS", evidenceExpected: true }],
      };
  }
}
