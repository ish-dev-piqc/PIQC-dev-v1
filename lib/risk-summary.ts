// =============================================================================
// VendorRiskSummary library (D-010)
//
// Owns:
//   - Stub creation (deterministic narrative composed from upstream data)
//   - Auditor edits (narrative + focus areas, delta-tracked)
//   - Approval gate (sets approvedAt/approvedBy; downstream drafting reads this)
//
// Cognitive-load discipline:
//   - studyContext + protocolRiskRefs auto-derived from upstream — auditor
//     never re-types therapeutic space, endpoints, or risk references
//   - Narrative starts as a deterministic paragraph the auditor edits down,
//     not a blank textarea
//   - Sponsor name is never included in any generated text — auditors add
//     branding externally on export
//
// All mutations delta-tracked under TrackedObjectType.VENDOR_RISK_SUMMARY_OBJECT.
// =============================================================================

import {
  ClinicalTrialPhase,
  ImpactSurface,
  Prisma,
  RiskSummaryApprovalStatus,
  TrackedObjectType,
  VendorRiskSummaryObject,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { diffFields, writeDelta } from "@/lib/state-history";
import {
  ApproveRiskSummaryInput,
  CreateRiskSummaryStubInput,
  RenderedRiskSummary,
  StudyContextSnapshot,
  UpdateRiskSummaryInput,
} from "@/lib/types/risk-summary";

// -----------------------------------------------------------------------------
// Get or create — used by stage transitions and the workspace panel.
// Idempotent: returns the existing summary if one already exists.
// -----------------------------------------------------------------------------
export async function getOrCreateRiskSummaryStub(
  input: CreateRiskSummaryStubInput
): Promise<VendorRiskSummaryObject> {
  const existing = await prisma.vendorRiskSummaryObject.findUnique({
    where: { auditId: input.auditId },
  });
  if (existing) return existing;
  return createRiskSummaryStub(input);
}

// -----------------------------------------------------------------------------
// Stub creation
// Composes a deterministic, sponsor-name-free narrative from:
//   - ProtocolVersion (therapeutic space, endpoints, clinical trial phase)
//   - ProtocolRiskObjects matched by operational domain to mapped vendor services
//   - VendorServiceObject (service type)
//
// The auditor edits this paragraph down — they do not start from blank.
// Future LLM-assisted generators replace this function behind the same shape.
// -----------------------------------------------------------------------------
export async function createRiskSummaryStub(
  input: CreateRiskSummaryStubInput
): Promise<VendorRiskSummaryObject> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.vendorRiskSummaryObject.findUnique({
      where: { auditId: input.auditId },
    });
    if (existing) {
      throw new Error(
        `VendorRiskSummaryObject already exists for audit ${input.auditId}. One per audit.`
      );
    }

    const audit = await tx.audit.findUnique({
      where: { id: input.auditId },
      include: {
        protocolVersion: { include: { riskObjects: true } },
        vendorService: { include: { mappings: true } },
      },
    });

    if (!audit) {
      throw new Error(`Audit ${input.auditId} not found`);
    }

    const studyContext = extractStudyContext(audit.protocolVersion);

    const mappedRiskIds = new Set<string>(
      (audit.vendorService?.mappings ?? []).map((m) => m.protocolRiskId)
    );
    const drivingRisks = audit.protocolVersion.riskObjects.filter((r) =>
      mappedRiskIds.has(r.id)
    );

    const focusAreas = uniqueOrderedDomains(
      drivingRisks.map((r) => r.operationalDomainTag)
    );

    const narrative = composeStubNarrative({
      studyContext,
      serviceType: audit.vendorService?.serviceType ?? null,
      serviceName: audit.vendorService?.serviceName ?? null,
      drivingRisks: drivingRisks.map((r) => ({
        sectionIdentifier: r.sectionIdentifier,
        operationalDomainTag: r.operationalDomainTag,
        impactSurface: r.impactSurface,
        timeSensitivity: r.timeSensitivity,
      })),
    });

    const created = await tx.vendorRiskSummaryObject.create({
      data: {
        auditId: input.auditId,
        studyContext: studyContext as unknown as Prisma.InputJsonValue,
        vendorRelevanceNarrative: narrative,
        focusAreas,
        approvalStatus: RiskSummaryApprovalStatus.DRAFT,
        protocolRiskRefs: {
          create: drivingRisks.map((r) => ({ protocolRiskId: r.id })),
        },
      },
    });

    await writeDelta(
      tx,
      TrackedObjectType.VENDOR_RISK_SUMMARY_OBJECT,
      created.id,
      {
        created: { from: null, to: { auditId: input.auditId, focusAreas } },
      },
      input.actorId,
      "Stub created from upstream protocol + service-mapping data"
    );

    return created;
  });
}

// -----------------------------------------------------------------------------
// Auditor edits — narrative + focus areas only.
// approvalStatus / approvedAt / approvedBy are NOT mutable here. Editing a
// previously approved summary returns it to DRAFT (re-approval required) so
// downstream drafting cannot silently consume mid-edit content.
// -----------------------------------------------------------------------------
export async function updateRiskSummary(
  input: UpdateRiskSummaryInput
): Promise<VendorRiskSummaryObject> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.vendorRiskSummaryObject.findUnique({
      where: { auditId: input.auditId },
    });
    if (!before) {
      throw new Error(
        `VendorRiskSummaryObject not found for audit ${input.auditId}. Create the stub first.`
      );
    }

    const patch: Prisma.VendorRiskSummaryObjectUpdateInput = {};
    if (input.vendorRelevanceNarrative !== undefined) {
      patch.vendorRelevanceNarrative = input.vendorRelevanceNarrative;
    }
    if (input.focusAreas !== undefined) {
      patch.focusAreas = input.focusAreas;
    }

    const wasApproved = before.approvalStatus === RiskSummaryApprovalStatus.APPROVED;
    if (wasApproved) {
      patch.approvalStatus = RiskSummaryApprovalStatus.DRAFT;
      patch.approvedAt = null;
      patch.approvedBy = null;
    }

    const updated = await tx.vendorRiskSummaryObject.update({
      where: { id: before.id },
      data: patch,
    });

    const changed = diffFields(before as unknown as Record<string, unknown>, {
      vendorRelevanceNarrative: updated.vendorRelevanceNarrative,
      focusAreas: updated.focusAreas,
      approvalStatus: updated.approvalStatus,
      approvedAt: updated.approvedAt,
      approvedBy: updated.approvedBy,
    });

    await writeDelta(
      tx,
      TrackedObjectType.VENDOR_RISK_SUMMARY_OBJECT,
      updated.id,
      changed,
      input.actorId,
      wasApproved ? "Edited after approval — returned to DRAFT" : undefined
    );

    return updated;
  });
}

// -----------------------------------------------------------------------------
// Approval gate
// Sets approvalStatus = APPROVED and stamps approvedAt/approvedBy. Idempotent
// re-approval re-stamps with the new actor (delta records the actor change).
// -----------------------------------------------------------------------------
export async function approveRiskSummary(
  input: ApproveRiskSummaryInput
): Promise<VendorRiskSummaryObject> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.vendorRiskSummaryObject.findUnique({
      where: { auditId: input.auditId },
    });
    if (!before) {
      throw new Error(
        `VendorRiskSummaryObject not found for audit ${input.auditId}. Cannot approve missing summary.`
      );
    }
    if (!before.vendorRelevanceNarrative.trim()) {
      throw new Error(
        "Cannot approve a risk summary with empty narrative. Edit the stub first."
      );
    }

    const approvedAt = new Date();
    const updated = await tx.vendorRiskSummaryObject.update({
      where: { id: before.id },
      data: {
        approvalStatus: RiskSummaryApprovalStatus.APPROVED,
        approvedAt,
        approvedBy: input.actorId,
      },
    });

    const changed = diffFields(before as unknown as Record<string, unknown>, {
      approvalStatus: updated.approvalStatus,
      approvedAt: updated.approvedAt,
      approvedBy: updated.approvedBy,
    });

    await writeDelta(
      tx,
      TrackedObjectType.VENDOR_RISK_SUMMARY_OBJECT,
      updated.id,
      changed,
      input.actorId,
      "Approved by auditor — downstream drafting may now consume this artifact"
    );

    return updated;
  });
}

// -----------------------------------------------------------------------------
// Read shape for the workspace
// -----------------------------------------------------------------------------
export async function getRenderedRiskSummary(
  auditId: string
): Promise<RenderedRiskSummary | null> {
  const row = await prisma.vendorRiskSummaryObject.findUnique({
    where: { auditId },
    include: {
      protocolRiskRefs: {
        include: { protocolRisk: true },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    auditId: row.auditId,
    studyContext: row.studyContext as unknown as StudyContextSnapshot,
    vendorRelevanceNarrative: row.vendorRelevanceNarrative,
    focusAreas: row.focusAreas,
    approvalStatus: row.approvalStatus,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedBy: row.approvedBy,
    protocolRiskRefs: row.protocolRiskRefs.map((ref) => ({
      id: ref.protocolRisk.id,
      sectionIdentifier: ref.protocolRisk.sectionIdentifier,
      sectionTitle: ref.protocolRisk.sectionTitle,
      operationalDomainTag: ref.protocolRisk.operationalDomainTag,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// =============================================================================
// Internal: deterministic stub composition
// =============================================================================

interface ProtocolVersionLike {
  clinicalTrialPhase: ClinicalTrialPhase;
  rawPiqcPayload: Prisma.JsonValue;
}

// Pulls therapeutic space + endpoints from the PIQC payload when present.
// PIQC field names are still pending D-009 — this reader is tolerant: any
// missing key yields null/empty, never a thrown error. The auditor sees the
// blanks and fills them in.
function extractStudyContext(version: ProtocolVersionLike): StudyContextSnapshot {
  const payload =
    version.rawPiqcPayload && typeof version.rawPiqcPayload === "object"
      ? (version.rawPiqcPayload as Record<string, unknown>)
      : {};

  const therapeuticSpace =
    typeof payload.therapeuticSpace === "string" ? payload.therapeuticSpace : null;

  const primaryEndpoints = Array.isArray(payload.primaryEndpoints)
    ? payload.primaryEndpoints.filter((s): s is string => typeof s === "string")
    : [];
  const secondaryEndpoints = Array.isArray(payload.secondaryEndpoints)
    ? payload.secondaryEndpoints.filter((s): s is string => typeof s === "string")
    : [];

  return {
    therapeuticSpace,
    primaryEndpoints,
    secondaryEndpoints,
    clinicalTrialPhase: version.clinicalTrialPhase,
    capturedAt: new Date().toISOString(),
  };
}

interface DrivingRiskInfo {
  sectionIdentifier: string;
  operationalDomainTag: string;
  impactSurface: ImpactSurface;
  timeSensitivity: boolean;
}

interface ComposeStubInput {
  studyContext: StudyContextSnapshot;
  serviceType: string | null;
  serviceName: string | null;
  drivingRisks: DrivingRiskInfo[];
}

// Deterministic English narrative. Sponsor-name-free.
// Three short paragraphs the auditor edits down: study context → vendor
// relevance → focus implications.
function composeStubNarrative(input: ComposeStubInput): string {
  const { studyContext, serviceType, serviceName, drivingRisks } = input;

  const phaseLabel = formatPhase(studyContext.clinicalTrialPhase);
  const therapeutic = studyContext.therapeuticSpace ?? "[therapeutic space]";
  const primary =
    studyContext.primaryEndpoints.length > 0
      ? studyContext.primaryEndpoints.join(", ")
      : "[primary endpoint(s)]";
  const secondary =
    studyContext.secondaryEndpoints.length > 0
      ? `Secondary endpoints include ${studyContext.secondaryEndpoints.join(", ")}.`
      : "";

  const studyPara = [
    `This audit concerns ${phaseLabel} study in ${therapeutic}.`,
    `The primary endpoint is ${primary}.`,
    secondary,
  ]
    .filter(Boolean)
    .join(" ");

  const serviceLabel = serviceName ?? serviceType ?? "[vendor service]";
  const vendorPara =
    drivingRisks.length > 0
      ? `The vendor (${serviceLabel}) supports protocol execution at ${drivingRisks.length} risk-tagged section${drivingRisks.length === 1 ? "" : "s"}: ${formatRiskList(drivingRisks)}.`
      : `The vendor (${serviceLabel}) is engaged for this study; no protocol risk objects have been mapped to this service yet — map the relevant sections before relying on this summary.`;

  const domains = uniqueOrderedDomains(
    drivingRisks.map((r) => r.operationalDomainTag)
  );
  const safetyTouching = drivingRisks.some(
    (r) => r.impactSurface === ImpactSurface.PATIENT_SAFETY || r.impactSurface === ImpactSurface.BOTH
  );
  const dataIntegrityTouching = drivingRisks.some(
    (r) => r.impactSurface === ImpactSurface.DATA_INTEGRITY || r.impactSurface === ImpactSurface.BOTH
  );
  const timeSensitive = drivingRisks.some((r) => r.timeSensitivity);

  const focusBullets: string[] = [];
  if (domains.length > 0) {
    focusBullets.push(`Operational domains in scope: ${domains.join(", ")}.`);
  }
  if (safetyTouching) {
    focusBullets.push(
      "Patient-safety surfaces are touched — pharmacovigilance handoffs and SAE reporting paths warrant scope depth."
    );
  }
  if (dataIntegrityTouching) {
    focusBullets.push(
      "Data-integrity surfaces are touched — Part 11 controls, audit trails, and source verification warrant scope depth."
    );
  }
  if (timeSensitive) {
    focusBullets.push(
      "At least one mapped section is time-sensitive — scrutinize turnaround SLAs and escalation paths."
    );
  }
  if (focusBullets.length === 0) {
    focusBullets.push(
      "No focus implications could be derived automatically — review mappings and add manual focus areas."
    );
  }

  const focusPara = `Audit focus implications:\n- ${focusBullets.join("\n- ")}`;

  return [studyPara, vendorPara, focusPara].join("\n\n");
}

function formatRiskList(risks: DrivingRiskInfo[]): string {
  // Cap at 5 to keep the stub readable; auditor sees full list in the protocolRiskRefs panel.
  const capped = risks.slice(0, 5);
  const formatted = capped
    .map((r) => `${r.sectionIdentifier} (${r.operationalDomainTag})`)
    .join(", ");
  return risks.length > capped.length
    ? `${formatted}, plus ${risks.length - capped.length} more`
    : formatted;
}

function formatPhase(phase: ClinicalTrialPhase): string {
  switch (phase) {
    case "PHASE_1":
      return "a Phase 1";
    case "PHASE_1_2":
      return "a Phase 1/2";
    case "PHASE_2":
      return "a Phase 2";
    case "PHASE_2_3":
      return "a Phase 2/3";
    case "PHASE_3":
      return "a Phase 3";
    case "PHASE_4":
      return "a Phase 4";
    case "NOT_APPLICABLE":
    default:
      return "a clinical";
  }
}

function uniqueOrderedDomains(domains: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of domains) {
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}
