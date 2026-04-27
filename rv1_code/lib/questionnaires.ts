// =============================================================================
// Questionnaire library (D-003)
//
// Owns:
//   - Instance creation (forks from canonical template version)
//   - Addendum generation (5.3.x questions from VendorServiceMappingObject)
//   - Response capture (auditor pre-fill, vendor return ingestion)
//   - Status transitions (DRAFT → … → COMPLETE)
//
// All status transitions and response writes are delta-tracked. The instance
// itself is tracked under TrackedObjectType.QUESTIONNAIRE_INSTANCE.
//
// Cognitive-load discipline:
//   - Vendor contact + audit context inherited via relations, not duplicated
//   - Question text never duplicated on response — read via questionId
//   - Addenda regenerate from upstream mappings; auditor never re-types
// =============================================================================

import {
  Prisma,
  QuestionnaireInstance,
  QuestionnaireInstanceStatus,
  QuestionOrigin,
  ResponseSource,
  ResponseStatus,
  TrackedObjectType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveAddendumCandidates } from "@/lib/questionnaire-addenda";
import { diffFields, writeDelta } from "@/lib/state-history";
import {
  CreateQuestionnaireInstanceInput,
  GenerateAddendaInput,
  InstanceStatusTransitionInput,
  RenderedQuestion,
  ResponseCaptureInput,
  VendorReturnInput,
} from "@/lib/types/questionnaire";

const ADDENDUM_SECTION_CODE = "5.3";
const ADDENDUM_SECTION_TITLE = "Service-Specific Addenda";

// -----------------------------------------------------------------------------
// Instance creation
// Forks from a canonical template version. Every TEMPLATE question gets a
// PENDING response row immediately so the workspace can render a complete
// state without lazy-creation logic later.
// -----------------------------------------------------------------------------
export async function createQuestionnaireInstance(
  input: CreateQuestionnaireInstanceInput
): Promise<QuestionnaireInstance> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.questionnaireInstance.findUnique({
      where: { auditId: input.auditId },
    });
    if (existing) {
      throw new Error(
        `QuestionnaireInstance already exists for audit ${input.auditId}. Phase 1 supports one instance per audit.`
      );
    }

    const template = await resolveDefaultTemplateVersion(tx, input.templateSlug);

    const instance = await tx.questionnaireInstance.create({
      data: {
        auditId: input.auditId,
        templateVersionId: template.id,
        status: QuestionnaireInstanceStatus.DRAFT,
        vendorContactName: input.vendorContactName ?? null,
        vendorContactEmail: input.vendorContactEmail ?? null,
        vendorContactTitle: input.vendorContactTitle ?? null,
      },
    });

    // Pre-create PENDING response rows for every template question.
    const templateQuestions = await tx.questionnaireQuestion.findMany({
      where: { templateVersionId: template.id },
      select: { id: true },
    });

    if (templateQuestions.length > 0) {
      await tx.questionnaireResponseObject.createMany({
        data: templateQuestions.map((q) => ({
          instanceId: instance.id,
          questionId: q.id,
          auditId: input.auditId,
          source: ResponseSource.PENDING,
          responseStatus: ResponseStatus.UNANSWERED,
        })),
      });
    }

    await writeDelta(
      tx,
      TrackedObjectType.QUESTIONNAIRE_INSTANCE,
      instance.id,
      {
        status: { from: null, to: instance.status },
        templateVersionId: { from: null, to: instance.templateVersionId },
      },
      input.actorId,
      "Questionnaire instance created"
    );

    return instance;
  });
}

async function resolveDefaultTemplateVersion(
  tx: Prisma.TransactionClient,
  slug?: string
) {
  const template = slug
    ? await tx.questionnaireTemplate.findUnique({ where: { slug } })
    : await tx.questionnaireTemplate.findFirst({ where: { isDefault: true } });

  if (!template) {
    throw new Error(
      slug
        ? `QuestionnaireTemplate with slug "${slug}" not found.`
        : "No default QuestionnaireTemplate exists. Run prisma db seed."
    );
  }

  const version = await tx.questionnaireTemplateVersion.findFirst({
    where: { templateId: template.id },
    orderBy: { versionNumber: "desc" },
  });

  if (!version) {
    throw new Error(
      `QuestionnaireTemplate "${template.slug}" has no published versions.`
    );
  }

  return version;
}

// -----------------------------------------------------------------------------
// Addendum generation
// Reads VendorServiceMappingObject entries for the audit, runs each through
// the rule table, and creates QuestionnaireQuestion rows + PENDING responses.
//
// Default mode: incremental — adds questions for mappings that don't yet
// have addendum coverage. Set replaceExisting=true to wipe and regenerate.
// -----------------------------------------------------------------------------
export async function generateAddenda(input: GenerateAddendaInput) {
  return prisma.$transaction(async (tx) => {
    const instance = await tx.questionnaireInstance.findUniqueOrThrow({
      where: { id: input.instanceId },
      include: {
        audit: {
          include: {
            protocolVersion: { select: { clinicalTrialPhase: true } },
            vendorService: { select: { serviceType: true } },
          },
        },
      },
    });

    const audit = instance.audit;
    const serviceType = audit.vendorService?.serviceType;
    if (!serviceType) {
      throw new Error(
        "Cannot generate addenda: audit has no VendorServiceObject yet. Define the vendor service first."
      );
    }

    const mappings = await tx.vendorServiceMappingObject.findMany({
      where: { vendorService: { auditId: audit.id } },
      include: {
        protocolRisk: { select: { operationalDomainTag: true } },
      },
    });

    if (input.replaceExisting) {
      // Wipe existing addendum questions (and their responses cascade — but Prisma
      // doesn't auto-cascade; delete responses first).
      const existingAddenda = await tx.questionnaireQuestion.findMany({
        where: { instanceId: instance.id },
        select: { id: true },
      });
      if (existingAddenda.length > 0) {
        const ids = existingAddenda.map((q) => q.id);
        await tx.questionnaireResponseObject.deleteMany({
          where: { questionId: { in: ids } },
        });
        await tx.questionnaireQuestion.deleteMany({
          where: { id: { in: ids } },
        });
      }
    }

    // Track existing rule keys per mapping to avoid duplicate questions on incremental runs.
    const existingByMapping = new Map<string, Set<string>>();
    if (!input.replaceExisting) {
      const existing = await tx.questionnaireQuestion.findMany({
        where: { instanceId: instance.id, origin: QuestionOrigin.ADDENDUM },
        select: { generatedFromMappingId: true, questionNumber: true, prompt: true },
      });
      // We use prompt as a coarse dedupe key since ruleKey isn't persisted on
      // the question itself — promptString is stable per rule. (Future: persist
      // ruleKey on QuestionnaireQuestion for cleaner dedupe.)
      for (const e of existing) {
        if (!e.generatedFromMappingId) continue;
        const set =
          existingByMapping.get(e.generatedFromMappingId) ?? new Set<string>();
        set.add(e.prompt);
        existingByMapping.set(e.generatedFromMappingId, set);
      }
    }

    // Compute next ordinal start for new questions.
    const maxOrdinal = await tx.questionnaireQuestion.aggregate({
      where: { instanceId: instance.id },
      _max: { ordinal: true },
    });
    let ordinal = (maxOrdinal._max.ordinal ?? 0) + 1;
    let counter = await tx.questionnaireQuestion.count({
      where: {
        instanceId: instance.id,
        sectionCode: ADDENDUM_SECTION_CODE,
      },
    });

    const created: { id: string; questionNumber: string }[] = [];

    for (const mapping of mappings) {
      const candidates = resolveAddendumCandidates({
        serviceType,
        derivedCriticality: mapping.derivedCriticality,
        clinicalTrialPhase: audit.protocolVersion.clinicalTrialPhase,
        operationalDomainTag: mapping.protocolRisk.operationalDomainTag,
      });

      const seenForMapping = existingByMapping.get(mapping.id) ?? new Set<string>();

      for (const candidate of candidates) {
        if (seenForMapping.has(candidate.prompt)) continue; // Already generated

        counter += 1;
        const questionNumber = `${ADDENDUM_SECTION_CODE}.${counter}`;

        const question = await tx.questionnaireQuestion.create({
          data: {
            origin: QuestionOrigin.ADDENDUM,
            instanceId: instance.id,
            questionNumber,
            sectionCode: ADDENDUM_SECTION_CODE,
            sectionTitle: ADDENDUM_SECTION_TITLE,
            prompt: candidate.prompt,
            answerType: candidate.answerType,
            evidenceExpected: candidate.evidenceExpected,
            domainTag: candidate.domainTag,
            generatedFromMappingId: mapping.id,
            ordinal: ordinal++,
          },
        });

        await tx.questionnaireResponseObject.create({
          data: {
            instanceId: instance.id,
            questionId: question.id,
            auditId: audit.id,
            vendorServiceMappingId: mapping.id,
            source: ResponseSource.PENDING,
            responseStatus: ResponseStatus.UNANSWERED,
          },
        });

        created.push({ id: question.id, questionNumber });
      }
    }

    if (created.length > 0) {
      await tx.questionnaireInstance.update({
        where: { id: instance.id },
        data: { addendaGeneratedAt: new Date() },
      });

      await writeDelta(
        tx,
        TrackedObjectType.QUESTIONNAIRE_INSTANCE,
        instance.id,
        {
          addendaGenerated: {
            from: null,
            to: created.map((c) => c.questionNumber),
          },
        },
        input.actorId,
        input.replaceExisting
          ? "Addenda regenerated (replace mode)"
          : "Addenda generated incrementally"
      );
    }

    return { createdCount: created.length, created };
  });
}

// -----------------------------------------------------------------------------
// Response capture
// Used for both auditor pre-fill and one-by-one updates. Vendor returns
// should use captureVendorReturn (bulk).
// -----------------------------------------------------------------------------
export async function captureResponse(input: ResponseCaptureInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.questionnaireResponseObject.findUniqueOrThrow({
      where: {
        instanceId_questionId: {
          instanceId: input.instanceId,
          questionId: input.questionId,
        },
      },
    });

    const next = {
      responseText: input.responseText ?? existing.responseText,
      responseStatus:
        input.responseStatus ??
        (input.responseText ? ResponseStatus.ANSWERED : existing.responseStatus),
      source: input.source,
      sourceReference: input.sourceReference ?? existing.sourceReference,
      confidenceFlag: input.confidenceFlag ?? existing.confidenceFlag,
      inconsistencyFlag: input.inconsistencyFlag ?? existing.inconsistencyFlag,
      inconsistencyNote: input.inconsistencyNote ?? existing.inconsistencyNote,
      vendorServiceMappingId:
        input.vendorServiceMappingId ?? existing.vendorServiceMappingId,
      respondedBy: input.respondedBy ?? existing.respondedBy,
      respondedAt: input.responseText ? new Date() : existing.respondedAt,
    };

    const changed = diffFields(
      {
        responseText:           existing.responseText,
        responseStatus:         existing.responseStatus,
        source:                 existing.source,
        sourceReference:        existing.sourceReference,
        confidenceFlag:         existing.confidenceFlag,
        inconsistencyFlag:      existing.inconsistencyFlag,
        inconsistencyNote:      existing.inconsistencyNote,
        vendorServiceMappingId: existing.vendorServiceMappingId,
        respondedBy:            existing.respondedBy,
        respondedAt:            existing.respondedAt,
      },
      next
    );

    const updated = await tx.questionnaireResponseObject.update({
      where: { id: existing.id },
      data: next,
    });

    await writeDelta(
      tx,
      TrackedObjectType.QUESTIONNAIRE_RESPONSE_OBJECT,
      updated.id,
      changed,
      input.actorId,
      `Response captured (${input.source})`
    );

    return updated;
  });
}

// -----------------------------------------------------------------------------
// Bulk vendor return ingestion
// Called when the vendor returns the questionnaire (PDF/email/portal). Each
// response is marked source=VENDOR. Status transitions to VENDOR_RESPONDED.
// -----------------------------------------------------------------------------
export async function captureVendorReturn(input: VendorReturnInput) {
  return prisma.$transaction(async (tx) => {
    const instance = await tx.questionnaireInstance.findUniqueOrThrow({
      where: { id: input.instanceId },
    });

    // Batch-read all existing response rows in a single query.
    // The original per-response findUniqueOrThrow produced N sequential reads
    // inside the transaction (180 queries for a 60-question return). One
    // findMany reduces that to 1 read + N writes.
    const existingRows = await tx.questionnaireResponseObject.findMany({
      where: {
        instanceId: input.instanceId,
        questionId: { in: input.responses.map((r) => r.questionId) },
      },
    });
    const byQuestionId = new Map(existingRows.map((row) => [row.questionId, row]));

    // Validate all questionIds are present before writing anything —
    // fail fast rather than partial-write on a bad bulk payload.
    const missing = input.responses.filter((r) => !byQuestionId.has(r.questionId));
    if (missing.length > 0) {
      throw new Error(
        `Response rows not found for questionIds: ${missing.map((r) => r.questionId).join(", ")}. ` +
          `Ensure the questionnaire instance was created before ingesting a vendor return.`
      );
    }

    const respondedAt = new Date();

    for (const r of input.responses) {
      const existing = byQuestionId.get(r.questionId)!;

      const next = {
        responseText: r.responseText,
        responseStatus: ResponseStatus.ANSWERED,
        source: ResponseSource.VENDOR,
        inconsistencyFlag: r.inconsistencyFlag ?? existing.inconsistencyFlag,
        inconsistencyNote: r.inconsistencyNote ?? existing.inconsistencyNote,
        respondedAt,
      };

      const changed = diffFields(
        {
          responseText: existing.responseText,
          responseStatus: existing.responseStatus,
          source: existing.source,
          inconsistencyFlag: existing.inconsistencyFlag,
          inconsistencyNote: existing.inconsistencyNote,
        },
        next
      );

      await tx.questionnaireResponseObject.update({
        where: { id: existing.id },
        data: next,
      });

      await writeDelta(
        tx,
        TrackedObjectType.QUESTIONNAIRE_RESPONSE_OBJECT,
        existing.id,
        changed,
        input.actorId,
        "Vendor return ingested"
      );
    }

    const transitioned = await tx.questionnaireInstance.update({
      where: { id: instance.id },
      data: {
        status: QuestionnaireInstanceStatus.VENDOR_RESPONDED,
        vendorRespondedAt: new Date(),
      },
    });

    await writeDelta(
      tx,
      TrackedObjectType.QUESTIONNAIRE_INSTANCE,
      instance.id,
      { status: { from: instance.status, to: transitioned.status } },
      input.actorId,
      `Vendor return ingested (${input.responses.length} responses)`
    );

    return transitioned;
  });
}

// -----------------------------------------------------------------------------
// Status transitions
// Enforced linear lifecycle. Backwards transitions are blocked — the auditor
// must explicitly request a re-open via a future endpoint if needed.
// -----------------------------------------------------------------------------
const ALLOWED_TRANSITIONS: Record<
  QuestionnaireInstanceStatus,
  QuestionnaireInstanceStatus[]
> = {
  DRAFT: [QuestionnaireInstanceStatus.PREFILL_IN_PROGRESS],
  PREFILL_IN_PROGRESS: [QuestionnaireInstanceStatus.READY_TO_SEND],
  READY_TO_SEND: [QuestionnaireInstanceStatus.SENT_TO_VENDOR],
  SENT_TO_VENDOR: [QuestionnaireInstanceStatus.VENDOR_RESPONDED],
  VENDOR_RESPONDED: [QuestionnaireInstanceStatus.COMPLETE],
  COMPLETE: [],
};

export async function transitionInstanceStatus(
  input: InstanceStatusTransitionInput
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.questionnaireInstance.findUniqueOrThrow({
      where: { id: input.instanceId },
    });

    const allowed = ALLOWED_TRANSITIONS[existing.status];
    if (!allowed.includes(input.toStatus)) {
      throw new Error(
        `Invalid status transition: ${existing.status} → ${input.toStatus}. Allowed: ${allowed.join(", ") || "none (terminal)"}.`
      );
    }

    const data: Prisma.QuestionnaireInstanceUpdateInput = {
      status: input.toStatus,
    };
    if (input.toStatus === QuestionnaireInstanceStatus.SENT_TO_VENDOR) {
      data.sentToVendorAt = new Date();
    }
    if (input.toStatus === QuestionnaireInstanceStatus.COMPLETE) {
      data.completedAt = new Date();
    }

    const updated = await tx.questionnaireInstance.update({
      where: { id: existing.id },
      data,
    });

    await writeDelta(
      tx,
      TrackedObjectType.QUESTIONNAIRE_INSTANCE,
      updated.id,
      { status: { from: existing.status, to: updated.status } },
      input.actorId,
      input.reason ?? `Status transition to ${input.toStatus}`
    );

    return updated;
  });
}

// -----------------------------------------------------------------------------
// Read shape for the workspace UI
// -----------------------------------------------------------------------------
export async function getRenderedQuestionnaire(
  instanceId: string
): Promise<{ instance: QuestionnaireInstance; questions: RenderedQuestion[] }> {
  const instance = await prisma.questionnaireInstance.findUniqueOrThrow({
    where: { id: instanceId },
  });

  const questions = await prisma.questionnaireQuestion.findMany({
    where: {
      OR: [
        { templateVersionId: instance.templateVersionId },
        { instanceId: instance.id },
      ],
    },
    orderBy: { ordinal: "asc" },
    include: {
      responses: { where: { instanceId: instance.id } },
    },
  });

  const rendered: RenderedQuestion[] = questions.map((q) => {
    const r = q.responses[0];
    return {
      id: q.id,
      origin: q.origin,
      questionNumber: q.questionNumber,
      sectionCode: q.sectionCode,
      sectionTitle: q.sectionTitle,
      prompt: q.prompt,
      answerType: q.answerType,
      evidenceExpected: q.evidenceExpected,
      domainTag: q.domainTag,
      ordinal: q.ordinal,
      response: r
        ? {
            id: r.id,
            responseText: r.responseText,
            responseStatus: r.responseStatus,
            source: r.source,
            sourceReference: r.sourceReference,
            confidenceFlag: r.confidenceFlag,
            inconsistencyFlag: r.inconsistencyFlag,
            inconsistencyNote: r.inconsistencyNote,
          }
        : null,
    };
  });

  return { instance, questions: rendered };
}

export async function getInstanceByAudit(auditId: string) {
  return prisma.questionnaireInstance.findUnique({ where: { auditId } });
}

// -----------------------------------------------------------------------------
// Markdown export (D-003)
// Serializes the rendered questionnaire to a "first draft" markdown document
// suitable for auditor polish in Word / Google Docs. Groups questions by
// section (preserving ordinal order from getRenderedQuestionnaire). Addendum
// questions (5.3.x) appear naturally in section order.
//
// Design principles:
//   - Sponsor-name-free — branding added externally on export
//   - Response attribution is explicit (source + reference)
//   - Flags (inconsistency, deferred, partial) surface inline so the auditor's
//     review list is complete without re-opening the workspace
// -----------------------------------------------------------------------------
export async function exportQuestionnaireMarkdown(
  instanceId: string
): Promise<string> {
  const { instance, questions } = await getRenderedQuestionnaire(instanceId);

  // Group questions by sectionCode in ordinal order (ordinal sort already
  // applied by getRenderedQuestionnaire). Insertion-ordered Map preserves sequence.
  const sections = new Map<
    string,
    { title: string; questions: RenderedQuestion[] }
  >();
  for (const q of questions) {
    if (!sections.has(q.sectionCode)) {
      sections.set(q.sectionCode, { title: q.sectionTitle, questions: [] });
    }
    sections.get(q.sectionCode)!.questions.push(q);
  }

  const lines: string[] = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  lines.push("# Standard GCP Vendor Questionnaire");
  lines.push("## First Draft — For Auditor Review and Polish");
  lines.push("");
  lines.push(
    `**Exported:** ${new Date().toISOString().slice(0, 10)}`
  );
  lines.push(`**Status:** ${_fmtInstanceStatus(instance.status)}`);
  if (instance.approvedAt) {
    lines.push(
      `**Approved:** ${new Date(instance.approvedAt).toISOString().slice(0, 10)}`
    );
  }
  if (instance.vendorContactName || instance.vendorContactEmail) {
    const parts = [instance.vendorContactName, instance.vendorContactEmail]
      .filter(Boolean)
      .join(" — ");
    const titleSuffix = instance.vendorContactTitle
      ? ` (${instance.vendorContactTitle})`
      : "";
    lines.push(`**Vendor contact:** ${parts}${titleSuffix}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── Sections ───────────────────────────────────────────────────────────────
  for (const [sectionCode, { title, questions: sqs }] of sections) {
    const isAddendum = sqs.some((q) => q.origin === QuestionOrigin.ADDENDUM);
    const addendumNote = isAddendum ? " _(Service-Specific Addendum)_" : "";
    lines.push(`## Section ${sectionCode} — ${title}${addendumNote}`);
    lines.push("");

    for (const q of sqs) {
      // Question prompt line
      lines.push(`**${q.questionNumber}** ${q.prompt}`);
      lines.push("");

      // Metadata line (answer type · evidence flag · domain tag)
      const meta: string[] = [_fmtAnswerType(q.answerType)];
      if (q.evidenceExpected) meta.push("Evidence expected");
      if (q.domainTag) meta.push(`Domain: ${q.domainTag}`);
      lines.push(`*${meta.join(" · ")}*`);
      lines.push("");

      // Response block
      _renderResponse(q, lines);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── Private serialization helpers ─────────────────────────────────────────────

function _renderResponse(q: RenderedQuestion, lines: string[]): void {
  const r = q.response;

  // No response row at all (can occur for freshly-added addendum questions)
  if (!r || r.source === ResponseSource.PENDING) {
    lines.push("> _(Pending — no response captured)_");
    return;
  }

  if (r.source === ResponseSource.NOT_APPLICABLE) {
    lines.push("> _Not applicable_");
    if (r.responseText) {
      lines.push(">");
      lines.push(`> Note: ${r.responseText}`);
    }
    return;
  }

  // Response text — preserve newlines as blockquote continuation lines
  if (r.responseText) {
    const responseLines = r.responseText.split("\n");
    lines.push(...responseLines.map((l) => `> ${l}`));
  } else {
    lines.push(`> _(${_fmtResponseStatus(r.responseStatus)})_`);
  }

  // Source attribution
  const sourceLabel = _fmtSource(r.source, r.sourceReference);
  if (sourceLabel) {
    lines.push(">");
    lines.push(`> *${sourceLabel}*`);
  }

  // Workflow-state notes (partial / deferred)
  if (r.responseStatus === ResponseStatus.PARTIAL) {
    lines.push(">");
    lines.push("> ⚑ _Partial response — auditor review needed_");
  }
  if (r.responseStatus === ResponseStatus.DEFERRED) {
    lines.push(">");
    lines.push("> ⏸ _Response deferred — follow-up required_");
  }

  // Quality flags
  if (r.inconsistencyFlag) {
    const note = r.inconsistencyNote ? `: ${r.inconsistencyNote}` : "";
    lines.push(">");
    lines.push(`> ⚠️ **Inconsistency flagged**${note}`);
  }
  if (r.confidenceFlag) {
    lines.push(">");
    lines.push("> ⚑ **Low-confidence flag** — auditor review recommended");
  }
}

function _fmtAnswerType(type: string): string {
  const labels: Record<string, string> = {
    NARRATIVE: "Narrative",
    YES_NO_QUALIFY: "Yes / No with qualifier",
    EVIDENCE_REQUEST: "Evidence / document request",
    LIST: "List",
    NUMERIC: "Numeric",
  };
  return labels[type] ?? type;
}

function _fmtSource(source: ResponseSource, ref: string | null): string {
  switch (source) {
    case ResponseSource.AUDITOR_PREFILL_WEB:
      return ref ? `Source: Web research — ${ref}` : "Source: Web research";
    case ResponseSource.AUDITOR_PREFILL_PRIOR_AUDIT:
      return "Source: Prior audit record";
    case ResponseSource.AUDITOR_AUTHORED:
      return "Source: Auditor";
    case ResponseSource.VENDOR:
      return "Source: Vendor response";
    default:
      return "";
  }
}

function _fmtResponseStatus(status: ResponseStatus): string {
  switch (status) {
    case ResponseStatus.ANSWERED:
      return "Answered — no text recorded";
    case ResponseStatus.UNANSWERED:
      return "Unanswered";
    case ResponseStatus.PARTIAL:
      return "Partial response";
    case ResponseStatus.DEFERRED:
      return "Deferred";
    default:
      return "Unknown status";
  }
}

function _fmtInstanceStatus(status: QuestionnaireInstanceStatus): string {
  const labels: Record<QuestionnaireInstanceStatus, string> = {
    DRAFT: "Draft",
    PREFILL_IN_PROGRESS: "Pre-fill in progress",
    READY_TO_SEND: "Ready to send",
    SENT_TO_VENDOR: "Sent to vendor",
    VENDOR_RESPONDED: "Vendor responded",
    COMPLETE: "Complete",
  };
  return labels[status] ?? status;
}

// -----------------------------------------------------------------------------
// Approval gate (D-010)
// Sets approvedAt/approvedBy. Distinct from `COMPLETE` status — the status
// enum tracks workflow position; approval is the explicit human gate that
// downstream drafting reads from.
// Refused unless status is COMPLETE.
// -----------------------------------------------------------------------------
export async function approveQuestionnaireInstance(input: {
  auditId: string;
  actorId: string;
}): Promise<QuestionnaireInstance> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.questionnaireInstance.findUnique({
      where: { auditId: input.auditId },
    });
    if (!before) {
      throw new Error(
        `QuestionnaireInstance not found for audit ${input.auditId}`
      );
    }
    if (before.status !== QuestionnaireInstanceStatus.COMPLETE) {
      throw new Error(
        `Cannot approve until questionnaire status is COMPLETE (currently ${before.status})`
      );
    }

    const approvedAt = new Date();
    const updated = await tx.questionnaireInstance.update({
      where: { id: before.id },
      data: { approvedAt, approvedBy: input.actorId },
    });

    await writeDelta(
      tx,
      TrackedObjectType.QUESTIONNAIRE_INSTANCE,
      updated.id,
      {
        approvedAt: { from: before.approvedAt, to: updated.approvedAt },
        approvedBy: { from: before.approvedBy, to: updated.approvedBy },
      },
      input.actorId,
      "Questionnaire approved by auditor — downstream drafting may consume this artifact"
    );

    return updated;
  });
}
