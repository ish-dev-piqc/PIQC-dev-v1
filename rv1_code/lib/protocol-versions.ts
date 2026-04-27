// =============================================================================
// Protocol version library
//
// Handles PIQC payload ingestion, ProtocolVersion creation, and the downstream
// invariants that must hold whenever a new version enters the system:
//   1. Previous ACTIVE version is set to SUPERSEDED
//   2. AmendmentAlert is created for each active Audit on the old version
//   3. AuditWorkspaceEntryObjects with a modified/removed risk object are flagged
// =============================================================================

import { AuditStatus, ProtocolVersionStatus, VersionChangeType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidatedPiqcPayload } from "@/lib/types/piqc";

// Ingest a PIQC payload. Creates Protocol (if new) and ProtocolVersion.
// Triggers amendment alerts for any active Audits on the previous version.
// Returns the created ProtocolVersion with its id.
export async function ingestProtocolVersion(payload: ValidatedPiqcPayload) {
  return prisma.$transaction(async (tx) => {
    // Find or create the root Protocol record.
    // Match on piqcProtocolId first (most reliable), fall back to studyNumber.
    // [PIQC] D-009: matching strategy may change depending on what PIQC sends.
    let protocol = await tx.protocol.findFirst({
      where: payload.studyNumber
        ? { studyNumber: payload.studyNumber }
        : undefined,
    });

    if (!protocol) {
      protocol = await tx.protocol.create({
        data: {
          studyNumber: payload.studyNumber ?? null,
          title: payload.title,
          sponsor: payload.sponsor,
        },
      });
    }

    // Determine next version number and find the currently ACTIVE version.
    const [versionCount, activeVersion] = await Promise.all([
      tx.protocolVersion.count({ where: { protocolId: protocol.id } }),
      tx.protocolVersion.findFirst({
        where: { protocolId: protocol.id, status: ProtocolVersionStatus.ACTIVE },
      }),
    ]);

    const nextVersionNumber = versionCount + 1;

    // Create the new ProtocolVersion.
    const newVersion = await tx.protocolVersion.create({
      data: {
        protocolId: protocol.id,
        versionNumber: nextVersionNumber,
        amendmentLabel: payload.amendmentLabel ?? null,
        status: ProtocolVersionStatus.ACTIVE,
        effectiveDate: payload.effectiveDate ? new Date(payload.effectiveDate) : null,
        piqcProtocolId: payload.piqcProtocolId,
        rawPiqcPayload: payload as unknown as Record<string, unknown>,
        receivedAt: new Date(),
      },
    });

    // Supersede the previous active version and trigger amendment flow.
    if (activeVersion) {
      await tx.protocolVersion.update({
        where: { id: activeVersion.id },
        data: { status: ProtocolVersionStatus.SUPERSEDED },
      });

      await createAmendmentAlerts(tx, activeVersion.id, newVersion.id);
    }

    return { protocol, protocolVersion: newVersion };
  });
}

// Creates AmendmentAlert for each active Audit pinned to the superseded version.
// Also flags AuditWorkspaceEntryObjects whose linked risk object was modified/removed.
// This is the Option A deterministic write — not a live computed flag.
async function createAmendmentAlerts(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  fromVersionId: string,
  toVersionId: string
) {
  const affectedAudits = await tx.audit.findMany({
    where: {
      protocolVersionId: fromVersionId,
      status: { in: [AuditStatus.DRAFT, AuditStatus.IN_PROGRESS, AuditStatus.REVIEW] },
    },
    select: { id: true },
    take: 500, // Phase 1: a protocol rarely has more than a handful of active audits
  });

  if (affectedAudits.length === 0) return;

  // Create one AmendmentAlert per affected Audit.
  await tx.amendmentAlert.createMany({
    data: affectedAudits.map((audit) => ({
      auditId: audit.id,
      fromVersionId,
      toVersionId,
    })),
  });

  // Flag workspace entries whose linked ProtocolRiskObject was modified or removed
  // in the new version. These entries need auditor re-confirmation.
  //
  // A risk object is "modified" if a risk object in the new version has
  // previousVersionRiskId pointing to it AND versionChangeType = MODIFIED.
  // A risk object is "removed" if nothing in the new version points back to it.
  //
  // We find all risk object IDs from the old version that were modified/removed.
  const modifiedRiskIds = await tx.protocolRiskObject.findMany({
    where: {
      protocolVersionId: toVersionId,
      versionChangeType: VersionChangeType.MODIFIED,
      previousVersionRiskId: { not: null },
    },
    select: { previousVersionRiskId: true },
    take: 500, // Phase 1: protocol sections per version are well below this
  });

  const oldVersionRiskIds = await tx.protocolRiskObject.findMany({
    where: { protocolVersionId: fromVersionId },
    select: { id: true },
    take: 500,
  });

  const modifiedOldIds = new Set(
    modifiedRiskIds
      .map((r) => r.previousVersionRiskId)
      .filter((id): id is string => id !== null)
  );

  const carryForwardIds = await tx.protocolRiskObject.findMany({
    where: {
      protocolVersionId: toVersionId,
      versionChangeType: { in: [VersionChangeType.UNCHANGED, VersionChangeType.MODIFIED] },
      previousVersionRiskId: { not: null },
    },
    select: { previousVersionRiskId: true },
    take: 500,
  });
  const carryForwardOldIds = new Set(
    carryForwardIds
      .map((r) => r.previousVersionRiskId)
      .filter((id): id is string => id !== null)
  );

  const removedOldIds = oldVersionRiskIds
    .map((r) => r.id)
    .filter((id) => !carryForwardOldIds.has(id));

  const outdatedRiskIds = [
    ...modifiedOldIds,
    ...removedOldIds,
  ];

  if (outdatedRiskIds.length === 0) return;

  const auditIds = affectedAudits.map((a) => a.id);

  await tx.auditWorkspaceEntryObject.updateMany({
    where: {
      auditId: { in: auditIds },
      protocolRiskId: { in: outdatedRiskIds },
      riskContextOutdated: false,
    },
    data: { riskContextOutdated: true },
  });
}

// Retrieves a ProtocolVersion with its sections and tagged risk objects.
// Used by the tagging page to render the section list.
export async function getProtocolVersionWithSections(protocolVersionId: string) {
  return prisma.protocolVersion.findUniqueOrThrow({
    where: { id: protocolVersionId },
    include: {
      protocol: true,
      riskObjects: {
        orderBy: { taggedAt: "asc" },
      },
    },
  });
}
