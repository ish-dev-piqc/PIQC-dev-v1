// =============================================================================
// Pre-Audit Drafting deliverables library (D-010 step 7 follow-up)
//
// Owns CRUD + approval for the three pre-audit deliverables:
//   - ConfirmationLetterObject
//   - AgendaObject
//   - ChecklistObject
//
// All three share the same shape (1:1 with Audit, Json content, approval
// gate, approver back-relation), so this library is generic over `kind`. A
// single dispatch table picks the right Prisma model + TrackedObjectType +
// stub composer + per-kind validity check.
//
// Patterns mirror lib/risk-summary.ts:
//   - Idempotent `getOrCreate` entry points
//   - Approval demoted to DRAFT on edit (downstream cannot consume mid-edit)
//   - All writes delta-tracked inside transactions
//   - Sponsor-name-free deterministic stubs
//
// Approval validity:
//   - Confirmation Letter: bodyText non-empty
//   - Agenda:              ≥1 item with non-empty topic
//   - Checklist:           ≥1 item with non-empty prompt
// =============================================================================

import {
  Audit,
  AuditType,
  DeliverableApprovalStatus,
  Prisma,
  TrackedObjectType,
} from "@prisma/client";
import type { ZodType } from "zod";
import { prisma } from "@/lib/prisma";
import { writeDelta } from "@/lib/state-history";
import { getRenderedRiskSummary } from "@/lib/risk-summary";
import {
  AgendaContent,
  AgendaContentSchema,
  AgendaDay,
  AgendaItem,
  ApproveDeliverableInput,
  ChecklistContent,
  ChecklistContentSchema,
  ChecklistItem,
  ConfirmationLetterContent,
  ConfirmationLetterContentSchema,
  CreateDeliverableStubInput,
  DeliverableKind,
  RenderedDeliverable,
  UpdateDeliverableInput,
} from "@/lib/types/deliverables";

// =============================================================================
// Errors
// =============================================================================
export class DeliverableError extends Error {
  readonly code:
    | "AUDIT_NOT_FOUND"
    | "DELIVERABLE_NOT_FOUND"
    | "ALREADY_EXISTS"
    | "INVALID_FOR_APPROVAL"
    | "INVALID_CONTENT_SHAPE";

  // Zod issues attached when code === "INVALID_CONTENT_SHAPE" so callers can
  // forward them to the auditor (the route hands them back in the 422 body).
  readonly issues?: ReadonlyArray<{ path: (string | number)[]; message: string }>;

  constructor(
    code: DeliverableError["code"],
    message: string,
    issues?: DeliverableError["issues"]
  ) {
    super(message);
    this.name = "DeliverableError";
    this.code = code;
    this.issues = issues;
  }
}

// =============================================================================
// Per-kind dispatch
// =============================================================================
type AnyContent = ConfirmationLetterContent | AgendaContent | ChecklistContent;

interface KindDispatch {
  trackedObjectType: TrackedObjectType;
  // Validates a Json blob into its strongly typed content. Throws on shape error.
  parseContent: (raw: unknown) => AnyContent;
  // Per-kind validity for approval (e.g. body non-empty, ≥1 item). Returns
  // null if approvable; otherwise a human-readable reason.
  approvalReason: (content: AnyContent) => string | null;
}

const DISPATCH: Record<DeliverableKind, KindDispatch> = {
  confirmationLetter: {
    trackedObjectType: TrackedObjectType.CONFIRMATION_LETTER_OBJECT,
    parseContent: (raw) => parseOrThrow(ConfirmationLetterContentSchema, raw),
    approvalReason: (c) => {
      const body = (c as ConfirmationLetterContent).bodyText.trim();
      return body ? null : "Confirmation letter body is empty.";
    },
  },
  agenda: {
    trackedObjectType: TrackedObjectType.AGENDA_OBJECT,
    parseContent: (raw) => parseOrThrow(AgendaContentSchema, raw),
    approvalReason: (c) => {
      const hasItem = ((c as AgendaContent).days ?? []).some(
        (d) => d.items.some((i) => i.topic.trim().length > 0)
      );
      return hasItem ? null : "Agenda has no items with a topic.";
    },
  },
  checklist: {
    trackedObjectType: TrackedObjectType.CHECKLIST_OBJECT,
    parseContent: (raw) => parseOrThrow(ChecklistContentSchema, raw),
    approvalReason: (c) => {
      const items = (c as ChecklistContent).items ?? [];
      const filled = items.filter((i) => i.prompt.trim().length > 0);
      return filled.length > 0 ? null : "Checklist has no items with a prompt.";
    },
  },
};

// Tiny helper — Zod parse with our typed error shape. Zod's issues survive
// onto the error so the route can forward them in the 422 response body and
// the auditor sees which field is wrong.
function parseOrThrow<T>(schema: ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new DeliverableError(
      "INVALID_CONTENT_SHAPE",
      "Content does not match the schema for this deliverable kind.",
      result.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }
  return result.data;
}

// -----------------------------------------------------------------------------
// Prisma model accessor — type-erased because all three models share the same
// shape but Prisma generates separate types per model. The runtime accessor
// works identically; we lose some compile-time narrowing across kinds, but
// every operation is read/write of identical fields.
// -----------------------------------------------------------------------------
type DeliverableTx = Prisma.TransactionClient | typeof prisma;

interface DeliverableModel {
  findUnique: (args: { where: { auditId: string } }) => Promise<DeliverableRow | null>;
  create: (args: { data: DeliverableCreateData }) => Promise<DeliverableRow>;
  update: (args: { where: { id: string }; data: DeliverableUpdateData }) => Promise<DeliverableRow>;
}

interface DeliverableRow {
  id: string;
  auditId: string;
  content: Prisma.JsonValue;
  approvalStatus: DeliverableApprovalStatus;
  approvedAt: Date | null;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DeliverableCreateData {
  auditId: string;
  content: Prisma.InputJsonValue;
  approvalStatus?: DeliverableApprovalStatus;
}

interface DeliverableUpdateData {
  content?: Prisma.InputJsonValue;
  approvalStatus?: DeliverableApprovalStatus;
  approvedAt?: Date | null;
  approvedBy?: string | null;
}

function getModel(tx: DeliverableTx, kind: DeliverableKind): DeliverableModel {
  switch (kind) {
    case "confirmationLetter": return tx.confirmationLetterObject as unknown as DeliverableModel;
    case "agenda":              return tx.agendaObject              as unknown as DeliverableModel;
    case "checklist":           return tx.checklistObject           as unknown as DeliverableModel;
  }
}

// =============================================================================
// Get-or-create stub (idempotent entry point)
// =============================================================================
export async function getOrCreateDeliverableStub(
  input: CreateDeliverableStubInput
): Promise<DeliverableRow> {
  const existing = await getModel(prisma, input.kind).findUnique({
    where: { auditId: input.auditId },
  });
  if (existing) return existing;
  return createDeliverableStub(input);
}

// =============================================================================
// Stub creation — composes a deterministic, sponsor-name-free starter doc
// from upstream context (audit + approved risk summary).
// =============================================================================
export async function createDeliverableStub(
  input: CreateDeliverableStubInput
): Promise<DeliverableRow> {
  return prisma.$transaction(async (tx) => {
    const model = getModel(tx, input.kind);

    const existing = await model.findUnique({ where: { auditId: input.auditId } });
    if (existing) {
      throw new DeliverableError(
        "ALREADY_EXISTS",
        `${input.kind} already exists for audit ${input.auditId}. One per audit.`
      );
    }

    const audit = await tx.audit.findUnique({
      where: { id: input.auditId },
      include: {
        vendor:        { select: { name: true } },
        leadAuditor:   { select: { name: true } },
        vendorService: { select: { serviceName: true, serviceType: true } },
        protocol:      { select: { studyNumber: true } },
      },
    });
    if (!audit) {
      throw new DeliverableError("AUDIT_NOT_FOUND", `Audit ${input.auditId} not found`);
    }

    // Approved risk summary feeds focus areas / objectives. If not approved,
    // the stub is still produced — auditor may be drafting in parallel — but
    // focus areas come up empty for them to fill.
    const riskSummary = await getRenderedRiskSummary(input.auditId);
    const focusAreas = riskSummary?.focusAreas ?? [];

    const content = composeStub(input.kind, audit, focusAreas);

    const created = await model.create({
      data: {
        auditId: input.auditId,
        content: content as Prisma.InputJsonValue,
        approvalStatus: DeliverableApprovalStatus.DRAFT,
      },
    });

    await writeDelta(
      tx,
      DISPATCH[input.kind].trackedObjectType,
      created.id,
      { created: { from: null, to: { auditId: input.auditId, kind: input.kind } } },
      input.actorId,
      "Deliverable stub created from upstream audit + risk summary context"
    );

    return created;
  });
}

// =============================================================================
// Update — auditor edits content. Demotes APPROVED → DRAFT (re-approval
// required). Same pattern as risk summary.
// =============================================================================
export async function updateDeliverable(
  input: UpdateDeliverableInput
): Promise<DeliverableRow> {
  // Validate content shape for this kind before writing.
  const validated = DISPATCH[input.kind].parseContent(input.content);

  return prisma.$transaction(async (tx) => {
    const model = getModel(tx, input.kind);

    const before = await model.findUnique({ where: { auditId: input.auditId } });
    if (!before) {
      throw new DeliverableError(
        "DELIVERABLE_NOT_FOUND",
        `${input.kind} not found for audit ${input.auditId}. Generate the stub first.`
      );
    }

    const wasApproved = before.approvalStatus === DeliverableApprovalStatus.APPROVED;
    const data: DeliverableUpdateData = {
      content: validated as Prisma.InputJsonValue,
      ...(wasApproved
        ? {
            approvalStatus: DeliverableApprovalStatus.DRAFT,
            approvedAt: null,
            approvedBy: null,
          }
        : {}),
    };

    const updated = await model.update({ where: { id: before.id }, data });

    // Delta records the whole content swap as one field change. Granular
    // diffing inside the Json blob is a future enhancement (track which
    // checklist items were edited); for now content-level + approval flip is
    // enough for traceability.
    const changedFields: Record<string, { from: unknown; to: unknown }> = {
      content: { from: before.content, to: updated.content },
    };
    if (wasApproved) {
      changedFields.approvalStatus = { from: before.approvalStatus, to: updated.approvalStatus };
      changedFields.approvedAt     = { from: before.approvedAt,     to: updated.approvedAt };
      changedFields.approvedBy     = { from: before.approvedBy,     to: updated.approvedBy };
    }

    await writeDelta(
      tx,
      DISPATCH[input.kind].trackedObjectType,
      updated.id,
      changedFields,
      input.actorId,
      wasApproved ? "Edited after approval — returned to DRAFT" : undefined
    );

    return updated;
  });
}

// =============================================================================
// Regenerate from upstream — recomputes the deterministic stub content from
// the current Audit + approved risk summary, then writes it over the existing
// row. Demotes APPROVED → DRAFT (re-approval required) — same invariant as
// updateDeliverable. If no row exists, falls through to a fresh createStub
// so the auditor can also use this entry point as a "create or refresh".
//
// Single delta records the content swap + approval flip with the reason
// "Regenerated from upstream context". Previous content is preserved in the
// delta's `from` so the change is auditable.
// =============================================================================
export async function regenerateDeliverable(
  input: CreateDeliverableStubInput
): Promise<DeliverableRow> {
  return prisma.$transaction(async (tx) => {
    const model = getModel(tx, input.kind);
    const existing = await model.findUnique({ where: { auditId: input.auditId } });

    const audit = await tx.audit.findUnique({
      where: { id: input.auditId },
      include: {
        vendor:        { select: { name: true } },
        leadAuditor:   { select: { name: true } },
        vendorService: { select: { serviceName: true, serviceType: true } },
        protocol:      { select: { studyNumber: true } },
      },
    });
    if (!audit) {
      throw new DeliverableError("AUDIT_NOT_FOUND", `Audit ${input.auditId} not found`);
    }

    const riskSummary = await getRenderedRiskSummary(input.auditId);
    const focusAreas = riskSummary?.focusAreas ?? [];
    const freshContent = composeStub(input.kind, audit, focusAreas);

    if (!existing) {
      // No prior row — create-fresh path. Single delta, "created from regenerate".
      const created = await model.create({
        data: {
          auditId: input.auditId,
          content: freshContent as Prisma.InputJsonValue,
          approvalStatus: DeliverableApprovalStatus.DRAFT,
        },
      });
      await writeDelta(
        tx,
        DISPATCH[input.kind].trackedObjectType,
        created.id,
        { created: { from: null, to: { auditId: input.auditId, kind: input.kind } } },
        input.actorId,
        "Regenerated from upstream — created fresh stub"
      );
      return created;
    }

    // Existing row — overwrite content, demote if approved.
    const wasApproved = existing.approvalStatus === DeliverableApprovalStatus.APPROVED;
    const updated = await model.update({
      where: { id: existing.id },
      data: {
        content: freshContent as Prisma.InputJsonValue,
        approvalStatus: DeliverableApprovalStatus.DRAFT,
        approvedAt: null,
        approvedBy: null,
      },
    });

    const changedFields: Record<string, { from: unknown; to: unknown }> = {
      content: { from: existing.content, to: updated.content },
    };
    if (wasApproved) {
      changedFields.approvalStatus = { from: existing.approvalStatus, to: updated.approvalStatus };
      changedFields.approvedAt     = { from: existing.approvedAt,     to: updated.approvedAt };
      changedFields.approvedBy     = { from: existing.approvedBy,     to: updated.approvedBy };
    }

    await writeDelta(
      tx,
      DISPATCH[input.kind].trackedObjectType,
      updated.id,
      changedFields,
      input.actorId,
      wasApproved
        ? "Regenerated from upstream — returned to DRAFT"
        : "Regenerated from upstream — content replaced"
    );

    return updated;
  });
}

// =============================================================================
// Approve — explicit human gate. Per-kind validity check before stamping.
// =============================================================================
export async function approveDeliverable(
  input: ApproveDeliverableInput
): Promise<DeliverableRow> {
  return prisma.$transaction(async (tx) => {
    const model = getModel(tx, input.kind);

    const before = await model.findUnique({ where: { auditId: input.auditId } });
    if (!before) {
      throw new DeliverableError(
        "DELIVERABLE_NOT_FOUND",
        `${input.kind} not found for audit ${input.auditId}. Cannot approve missing deliverable.`
      );
    }

    const content = DISPATCH[input.kind].parseContent(before.content);
    const reason  = DISPATCH[input.kind].approvalReason(content);
    if (reason) {
      throw new DeliverableError("INVALID_FOR_APPROVAL", reason);
    }

    const approvedAt = new Date();
    const updated = await model.update({
      where: { id: before.id },
      data: {
        approvalStatus: DeliverableApprovalStatus.APPROVED,
        approvedAt,
        approvedBy: input.actorId,
      },
    });

    await writeDelta(
      tx,
      DISPATCH[input.kind].trackedObjectType,
      updated.id,
      {
        approvalStatus: { from: before.approvalStatus, to: updated.approvalStatus },
        approvedAt:     { from: before.approvedAt,     to: updated.approvedAt },
        approvedBy:     { from: before.approvedBy,     to: updated.approvedBy },
      },
      input.actorId,
      "Approved by auditor — downstream report drafting may now consume this artifact"
    );

    return updated;
  });
}

// =============================================================================
// Read shape for the workspace
// =============================================================================
export async function getRenderedDeliverable(
  auditId: string,
  kind: DeliverableKind
): Promise<RenderedDeliverable | null> {
  const row = await getModel(prisma, kind).findUnique({ where: { auditId } });
  if (!row) return null;

  return {
    id:             row.id,
    auditId:        row.auditId,
    kind,
    content:        DISPATCH[kind].parseContent(row.content),
    approvalStatus: row.approvalStatus,
    approvedAt:     row.approvedAt?.toISOString() ?? null,
    approvedBy:     row.approvedBy,
    createdAt:      row.createdAt.toISOString(),
    updatedAt:      row.updatedAt.toISOString(),
  };
}

// Convenience: load all three for the workspace page.
export async function getAllRenderedDeliverables(
  auditId: string
): Promise<Record<DeliverableKind, RenderedDeliverable | null>> {
  const [letter, agenda, checklist] = await Promise.all([
    getRenderedDeliverable(auditId, "confirmationLetter"),
    getRenderedDeliverable(auditId, "agenda"),
    getRenderedDeliverable(auditId, "checklist"),
  ]);
  return {
    confirmationLetter: letter,
    agenda,
    checklist,
  };
}

// =============================================================================
// Internal: deterministic stub composers
// =============================================================================
type AuditWithContext = Audit & {
  vendor:        { name: string };
  leadAuditor:   { name: string };
  vendorService: { serviceName: string; serviceType: string } | null;
  protocol:      { studyNumber: string } | null;
};

function composeStub(
  kind: DeliverableKind,
  audit: AuditWithContext,
  focusAreas: string[]
): AnyContent {
  switch (kind) {
    case "confirmationLetter": return composeConfirmationLetter(audit);
    case "agenda":              return composeAgenda(audit, focusAreas);
    case "checklist":           return composeChecklist(audit, focusAreas);
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown deliverable kind: ${_exhaustive}`);
    }
  }
}

function composeConfirmationLetter(audit: AuditWithContext): ConfirmationLetterContent {
  const dateLine = audit.scheduledDate
    ? new Date(audit.scheduledDate).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      })
    : "[scheduled date]";
  const serviceLine = audit.vendorService?.serviceName ?? "[vendor service]";
  const auditTypeLine =
    audit.auditType === AuditType.REMOTE  ? "remote"
    : audit.auditType === AuditType.ONSITE ? "on-site"
    : "hybrid";

  // Defined once — body text and returned fields reference the same variables
  // so they stay in sync when the defaults are changed.
  const auditStartTime = "09:00";
  const auditEndTime   = "16:00";

  // Pre-audit document list drawn from the real confirmation letter template.
  // Scope varies per vendor service — auditor edits this list before sending.
  const preAuditDocuments = [
    "Organizational overview and organizational charts (company history, leadership structure, regulatory and quality organizations)",
    "Overview of provided services (capabilities specifically related to this audit's scope)",
    "Overview of client types served (sponsors, CROs, SMOs, investigative sites, etc.)",
    "Overview of regulatory or health authority inspections and outcomes",
    "Overview of Quality Management System (issue management, risk management, CAPA, deviation handling)",
    "Company controlled documents — SOPs, working instructions, templates — and table of contents",
    "Overview of validation methodology and computerized systems inventory",
    "CVs, job descriptions, and training records for key personnel",
  ];

  // Q5 resolution: date embedded in body; no separate auditDate field on letter.
  const body = [
    `This letter serves as confirmation of our ${auditTypeLine} audit, scheduled for ${dateLine}, to perform a GxP Vendor Qualification Audit covering ${serviceLine}.`,
    `${audit.leadAuditor.name} will serve as lead auditor and expects to begin at approximately ${auditStartTime} and conclude around ${auditEndTime}. Please confirm these times are suitable or propose an alternative.`,
    `The audit will be conducted to assess the compliance and suitability of ${audit.vendor.name}'s policies, procedures, and practices related to ${serviceLine}.`,
    `Please ensure the documentation listed above is readily available at the start of the audit. The agenda, which outlines the processes and documentation we plan to review and discuss, is included separately.`,
    `Thank you for your assistance in advance. Please reply to confirm receipt of this letter and flag any scheduling conflicts.`,
  ].join("\n\n");

  return {
    to:                   audit.vendor.name,
    vendorContactTitle:   "",
    vendorContactAddress: "",
    from:                 audit.leadAuditor.name,
    subject:              `Audit confirmation — ${audit.vendor.name} — ${dateLine}`,
    auditStartTime,
    auditEndTime,
    preAuditDocuments,
    bodyText:             body,
    ccRecipients:         [],
  };
}

function composeAgenda(audit: AuditWithContext, focusAreas: string[]): AgendaContent {
  const sd = audit.scheduledDate;
  const day1Date = sd ? sd.toISOString().slice(0, 10) : null;
  // Day 2 = Day 1 + 1 day. Standard audit spans 2 days; auditor adjusts as needed.
  const day2Date = sd
    ? new Date(sd.getTime() + 86_400_000).toISOString().slice(0, 10)
    : null;

  const leadAuditor  = audit.leadAuditor.name;
  const vendorName   = audit.vendor.name;
  const serviceLine  = audit.vendorService?.serviceName ?? "[vendor service]";
  const studyNumber  = audit.protocol?.studyNumber ?? "[study number]";

  const auditModeText =
    audit.auditType === AuditType.REMOTE  ? "conducted remotely via video conference and secure document sharing"
    : audit.auditType === AuditType.ONSITE ? "conducted on-site at the auditee's facility"
    : "conducted as a hybrid — document review remote, site visit on-site";

  // Focus-area deep-dive slots: one item per focus area, or a placeholder.
  // `time` intentionally omitted — it's optional; an empty string would render
  // as a controlled empty input rather than the input's placeholder.
  const focusSlots: AgendaItem[] = focusAreas.length > 0
    ? focusAreas.map((area) => ({
        topic: `Focus area deep dive: ${area}`,
        owner: `${vendorName} / ${leadAuditor}`,
      }))
    : [{ topic: "Focus area deep dives (edit from approved risk summary)", owner: leadAuditor }];

  const day1Items: AgendaItem[] = [
    {
      time:  "09:00–09:30",
      topic: "Opening meeting — introductions, presentation of audit objectives and agenda, identification of key personnel",
      owner: `${leadAuditor} / ${vendorName}`,
    },
    {
      time:  "09:30–10:30",
      topic: "Organisational structure and quality management system overview",
      owner: `${vendorName} QA`,
    },
    {
      time:  "10:30–12:00",
      topic: `${serviceLine} — service-specific procedures, controls, and inspection history`,
      owner: `${vendorName} operations`,
    },
    {
      time:  "13:00–14:30",
      topic: "Evidence review — documentation and records (per audit checklist)",
      owner: leadAuditor,
    },
    ...focusSlots,
    {
      time:  "15:30–16:00",
      topic: "Day 1 wrap-up — outstanding questions and logistics for Day 2",
      owner: leadAuditor,
    },
  ];

  const day2Items: AgendaItem[] = [
    {
      time:  "09:00–10:00",
      topic: "Continued evidence review and clarification of Day 1 findings",
      owner: leadAuditor,
    },
    {
      time:  "10:00–11:30",
      topic: "Findings discussion — review of observations and auditor questions",
      owner: `${leadAuditor} / ${vendorName}`,
    },
    {
      time:  "11:30–12:00",
      topic: "Audit closeout meeting — debrief, next steps, and timeline for CAPA response",
      owner: leadAuditor,
    },
  ];

  const days: AgendaDay[] = [
    { date: day1Date, label: "Day 1", items: day1Items },
    { date: day2Date, label: "Day 2", items: day2Items },
  ];

  return {
    auditeeAddress: "",   // auditor fills — vendor street address
    projects:       studyNumber,
    auditScope:     focusAreas.length > 0
      ? `${serviceLine} — ${focusAreas.join("; ")}`
      : serviceLine,
    conductSummary: `This audit will be ${auditModeText}. Documentation will be reviewed in advance and/or during the audit, and interviews conducted with key personnel on the processes and areas listed below.`,
    attendees:      [leadAuditor],
    objectives:     focusAreas.length > 0 ? focusAreas : [],
    days,
  };
}

function composeChecklist(audit: AuditWithContext, focusAreas: string[]): ChecklistContent {
  const serviceLabel = audit.vendorService?.serviceName
    ? `${audit.vendor.name} — ${audit.vendorService.serviceName}`
    : audit.vendor.name;

  // Seed a small set of universal checklist items per focus area. Auditor
  // adds kind-specific items. Phase 1 has no SOP linkage (D-004 stub) — items
  // carry plain checkpointRef text or none.
  const items: ChecklistItem[] = focusAreas.length > 0
    ? focusAreas.flatMap((area, i) => [
        {
          id: `focus-${i}-controls`,
          prompt: `Verify ${area.toLowerCase()} controls are documented and operational.`,
          evidenceExpected: true,
        },
        {
          id: `focus-${i}-evidence`,
          prompt: `Inspect recent evidence demonstrating ${area.toLowerCase()} effectiveness (last 12 months).`,
          evidenceExpected: true,
        },
      ])
    : [
        {
          id: "default-qms",
          prompt: "Confirm Quality Management System scope and recent internal audit history.",
          evidenceExpected: true,
        },
      ];

  return {
    auditContext: serviceLabel,
    focusAreas,
    items,
  };
}
