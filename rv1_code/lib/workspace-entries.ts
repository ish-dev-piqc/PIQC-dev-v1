// =============================================================================
// AuditWorkspaceEntryObject library
//
// Owns the full lifecycle of audit-day observation entries:
//   - createWorkspaceEntry: write entry + inherit risk attrs snapshot + delta
//   - updateWorkspaceEntry: diffFields on editable fields + delta
//   - listWorkspaceEntries: read all entries for an audit, joined for display
//   - confirmRiskContext:   auditor re-confirms after amendment alert
//
// Risk attribute inheritance:
//   When protocolRiskId is supplied, endpointTier / impactSurface /
//   timeSensitivity are copied from the ProtocolRiskObject at write time.
//   These fields are a stable snapshot — they do not update if the upstream
//   risk object is later edited. riskContextOutdated is set to true by the
//   amendment ingestion route (lib/protocol-versions.ts) when the source
//   risk object changes; confirmRiskContext resets it.
//
// D-004 stub: checkpointRef is stored as plain text. Phase 2 replaces with FK.
// D-008: no autonomous classification proposals in this library.
// =============================================================================

import { ProvisionalClassification, ProvisionalImpact, TrackedObjectType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { diffFields, writeDelta } from "@/lib/state-history";
import {
  ConfirmRiskContextInput,
  CreateWorkspaceEntryInput,
  RenderedWorkspaceEntry,
  UpdateWorkspaceEntryInput,
} from "@/lib/types/workspace-entries";

// =============================================================================
// Errors
// =============================================================================

export class WorkspaceEntryError extends Error {
  readonly code: "ENTRY_NOT_FOUND" | "AUDIT_NOT_FOUND" | "RISK_OBJECT_NOT_FOUND";

  constructor(code: WorkspaceEntryError["code"], message: string) {
    super(message);
    this.name = "WorkspaceEntryError";
    this.code = code;
  }
}

// =============================================================================
// createWorkspaceEntry
// =============================================================================

export async function createWorkspaceEntry(
  auditId: string,
  input: CreateWorkspaceEntryInput
): Promise<RenderedWorkspaceEntry> {
  return prisma.$transaction(async (tx) => {
    // Verify audit exists
    const audit = await tx.audit.findUnique({ where: { id: auditId } });
    if (!audit) throw new WorkspaceEntryError("AUDIT_NOT_FOUND", `Audit ${auditId} not found`);

    // Inherit risk attrs if a protocol risk is linked
    let riskAttrsInherited = false;
    let inheritedEndpointTier = null;
    let inheritedImpactSurface = null;
    let inheritedTimeSensitivity = null;

    if (input.protocolRiskId) {
      const riskObj = await tx.protocolRiskObject.findUnique({
        where: { id: input.protocolRiskId },
      });
      if (!riskObj) {
        throw new WorkspaceEntryError(
          "RISK_OBJECT_NOT_FOUND",
          `ProtocolRiskObject ${input.protocolRiskId} not found`
        );
      }
      riskAttrsInherited = true;
      inheritedEndpointTier = riskObj.endpointTier;
      inheritedImpactSurface = riskObj.impactSurface;
      inheritedTimeSensitivity = riskObj.timeSensitivity;
    }

    const entry = await tx.auditWorkspaceEntryObject.create({
      data: {
        auditId,
        vendorDomain:            input.vendorDomain,
        observationText:         input.observationText,
        provisionalImpact:       input.provisionalImpact ?? ProvisionalImpact.NONE,
        provisionalClassification: input.provisionalClassification ?? ProvisionalClassification.NOT_YET_CLASSIFIED,
        checkpointRef:           input.checkpointRef ?? null,
        protocolRiskId:          input.protocolRiskId ?? null,
        vendorServiceMappingId:  input.vendorServiceMappingId ?? null,
        questionnaireResponseId: input.questionnaireResponseId ?? null,
        riskAttrsInherited,
        inheritedEndpointTier,
        inheritedImpactSurface,
        inheritedTimeSensitivity,
        createdBy: input.actorId,
      },
      include: {
        protocolRisk:         { select: { id: true, sectionIdentifier: true, sectionTitle: true } },
        vendorServiceMapping: { select: { id: true, derivedCriticality: true } },
        creator:              { select: { name: true } },
      },
    });

    await writeDelta(
      tx,
      TrackedObjectType.AUDIT_WORKSPACE_ENTRY_OBJECT,
      entry.id,
      {
        vendorDomain:             { from: null, to: entry.vendorDomain },
        observationText:          { from: null, to: entry.observationText },
        provisionalImpact:        { from: null, to: entry.provisionalImpact },
        provisionalClassification: { from: null, to: entry.provisionalClassification },
        ...(entry.checkpointRef ? { checkpointRef: { from: null, to: entry.checkpointRef } } : {}),
        ...(riskAttrsInherited ? {
          inheritedEndpointTier:    { from: null, to: inheritedEndpointTier },
          inheritedImpactSurface:   { from: null, to: inheritedImpactSurface },
          inheritedTimeSensitivity: { from: null, to: inheritedTimeSensitivity },
        } : {}),
      },
      input.actorId,
      "Entry created"
    );

    return toRendered(entry);
  });
}

// =============================================================================
// updateWorkspaceEntry
// =============================================================================

export async function updateWorkspaceEntry(
  entryId: string,
  input: UpdateWorkspaceEntryInput
): Promise<RenderedWorkspaceEntry> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.auditWorkspaceEntryObject.findUnique({
      where: { id: entryId },
    });
    if (!existing) {
      throw new WorkspaceEntryError("ENTRY_NOT_FOUND", `WorkspaceEntry ${entryId} not found`);
    }

    const changed = diffFields(
      {
        observationText:          existing.observationText,
        provisionalImpact:        existing.provisionalImpact,
        provisionalClassification: existing.provisionalClassification,
        checkpointRef:            existing.checkpointRef,
      },
      {
        ...(input.observationText !== undefined          ? { observationText: input.observationText } : {}),
        ...(input.provisionalImpact !== undefined        ? { provisionalImpact: input.provisionalImpact } : {}),
        ...(input.provisionalClassification !== undefined ? { provisionalClassification: input.provisionalClassification } : {}),
        ...(input.checkpointRef !== undefined            ? { checkpointRef: input.checkpointRef } : {}),
      }
    );

    const updated = await tx.auditWorkspaceEntryObject.update({
      where: { id: entryId },
      data: {
        ...(input.observationText !== undefined          ? { observationText: input.observationText } : {}),
        ...(input.provisionalImpact !== undefined        ? { provisionalImpact: input.provisionalImpact } : {}),
        ...(input.provisionalClassification !== undefined ? { provisionalClassification: input.provisionalClassification } : {}),
        ...(input.checkpointRef !== undefined            ? { checkpointRef: input.checkpointRef } : {}),
      },
      include: {
        protocolRisk:         { select: { id: true, sectionIdentifier: true, sectionTitle: true } },
        vendorServiceMapping: { select: { id: true, derivedCriticality: true } },
        creator:              { select: { name: true } },
      },
    });

    await writeDelta(
      tx,
      TrackedObjectType.AUDIT_WORKSPACE_ENTRY_OBJECT,
      entryId,
      changed,
      input.actorId,
      input.reason
    );

    return toRendered(updated);
  });
}

// =============================================================================
// listWorkspaceEntries
// =============================================================================

export async function listWorkspaceEntries(auditId: string): Promise<RenderedWorkspaceEntry[]> {
  const rows = await prisma.auditWorkspaceEntryObject.findMany({
    where:   { auditId },
    orderBy: { createdAt: "asc" },
    include: {
      protocolRisk:         { select: { id: true, sectionIdentifier: true, sectionTitle: true } },
      vendorServiceMapping: { select: { id: true, derivedCriticality: true } },
      creator:              { select: { name: true } },
    },
  });

  return rows.map(toRendered);
}

// =============================================================================
// confirmRiskContext
// Auditor explicitly re-confirms an entry whose linked risk object was
// modified by a protocol amendment. Clears the riskContextOutdated flag.
// =============================================================================

export async function confirmRiskContext(
  entryId: string,
  input: ConfirmRiskContextInput
): Promise<RenderedWorkspaceEntry> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.auditWorkspaceEntryObject.findUnique({
      where: { id: entryId },
    });
    if (!existing) {
      throw new WorkspaceEntryError("ENTRY_NOT_FOUND", `WorkspaceEntry ${entryId} not found`);
    }

    const confirmedAt = new Date();

    const updated = await tx.auditWorkspaceEntryObject.update({
      where: { id: entryId },
      data: {
        riskContextOutdated:    false,
        riskContextConfirmedAt: confirmedAt,
        riskContextConfirmedBy: input.actorId,
      },
      include: {
        protocolRisk:         { select: { id: true, sectionIdentifier: true, sectionTitle: true } },
        vendorServiceMapping: { select: { id: true, derivedCriticality: true } },
        creator:              { select: { name: true } },
      },
    });

    await writeDelta(
      tx,
      TrackedObjectType.AUDIT_WORKSPACE_ENTRY_OBJECT,
      entryId,
      {
        riskContextOutdated:    { from: true, to: false },
        riskContextConfirmedAt: { from: null, to: confirmedAt.toISOString() },
      },
      input.actorId,
      "Risk context re-confirmed after amendment"
    );

    return toRendered(updated);
  });
}

// =============================================================================
// Internal helpers
// =============================================================================

type EntryWithIncludes = Awaited<
  ReturnType<typeof prisma.auditWorkspaceEntryObject.findUniqueOrThrow>
> & {
  protocolRisk:         { id: string; sectionIdentifier: string; sectionTitle: string } | null;
  vendorServiceMapping: { id: string; derivedCriticality: import("@prisma/client").DerivedCriticality } | null;
  creator:              { name: string };
};

function toRendered(entry: EntryWithIncludes): RenderedWorkspaceEntry {
  return {
    id:                       entry.id,
    auditId:                  entry.auditId,
    vendorDomain:             entry.vendorDomain,
    observationText:          entry.observationText,
    provisionalImpact:        entry.provisionalImpact,
    provisionalClassification: entry.provisionalClassification,
    checkpointRef:            entry.checkpointRef,
    riskAttrsInherited:       entry.riskAttrsInherited,
    inheritedEndpointTier:    entry.inheritedEndpointTier,
    inheritedImpactSurface:   entry.inheritedImpactSurface,
    inheritedTimeSensitivity: entry.inheritedTimeSensitivity,
    riskContextOutdated:      entry.riskContextOutdated,
    riskContextConfirmedAt:   entry.riskContextConfirmedAt?.toISOString() ?? null,
    protocolRisk:             entry.protocolRisk,
    vendorServiceMapping:     entry.vendorServiceMapping,
    questionnaireResponseId:  entry.questionnaireResponseId,
    createdBy:   entry.createdBy,
    creatorName: entry.creator.name,
    createdAt:   entry.createdAt.toISOString(),
    updatedAt:   entry.updatedAt.toISOString(),
  };
}
