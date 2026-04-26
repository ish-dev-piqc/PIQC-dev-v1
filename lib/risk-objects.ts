// =============================================================================
// ProtocolRiskObject library
//
// All creates and updates go through here. Every mutation writes a
// StateHistoryDelta in the same transaction — this is enforced at the lib
// layer, not in route handlers.
// =============================================================================

import { TaggingMode, TrackedObjectType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { diffFields, writeDelta } from "@/lib/state-history";
import {
  CreateRiskObjectInput,
  UpdateRiskObjectInput,
  SuggestionProvenance,
} from "@/lib/types/risk-tagging";

// Creates a ProtocolRiskObject from auditor-confirmed form values.
// Builds suggestionProvenance when suggestions were present so override
// rates can be analysed later.
export async function createRiskObject(
  protocolVersionId: string,
  input: CreateRiskObjectInput
) {
  const provenance = input.suggestions
    ? buildProvenance(input)
    : null;

  return prisma.$transaction(async (tx) => {
    const riskObject = await tx.protocolRiskObject.create({
      data: {
        protocolVersionId,
        sectionIdentifier: input.sectionIdentifier,
        sectionTitle: input.sectionTitle,
        endpointTier: input.values.endpointTier,
        impactSurface: input.values.impactSurface,
        timeSensitivity: input.values.timeSensitivity,
        vendorDependencyFlags: input.values.vendorDependencyFlags,
        operationalDomainTag: input.values.operationalDomainTag,
        taggingMode: input.taggingMode,
        suggestionProvenance: provenance ?? undefined,
        versionChangeType: "ADDED",
        taggedBy: input.taggedBy,
        taggedAt: new Date(),
      },
    });

    await writeDelta(
      tx,
      TrackedObjectType.PROTOCOL_RISK_OBJECT,
      riskObject.id,
      {
        endpointTier: { from: null, to: riskObject.endpointTier },
        impactSurface: { from: null, to: riskObject.impactSurface },
        timeSensitivity: { from: null, to: riskObject.timeSensitivity },
        vendorDependencyFlags: { from: null, to: riskObject.vendorDependencyFlags },
        operationalDomainTag: { from: null, to: riskObject.operationalDomainTag },
        taggingMode: { from: null, to: riskObject.taggingMode },
      },
      input.taggedBy,
      "Initial tagging"
    );

    return riskObject;
  });
}

// Updates a ProtocolRiskObject. Only changed fields are written.
// Writes a StateHistoryDelta with before/after for the changed fields.
export async function updateRiskObject(
  riskObjectId: string,
  input: UpdateRiskObjectInput
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.protocolRiskObject.findUniqueOrThrow({
      where: { id: riskObjectId },
    });

    const changed = diffFields(
      {
        endpointTier: existing.endpointTier,
        impactSurface: existing.impactSurface,
        timeSensitivity: existing.timeSensitivity,
        vendorDependencyFlags: existing.vendorDependencyFlags,
        operationalDomainTag: existing.operationalDomainTag,
      },
      input.values
    );

    const updated = await tx.protocolRiskObject.update({
      where: { id: riskObjectId },
      data: input.values,
    });

    await writeDelta(
      tx,
      TrackedObjectType.PROTOCOL_RISK_OBJECT,
      riskObjectId,
      changed,
      input.actorId,
      input.reason
    );

    return updated;
  });
}

// Gets all tagged risk objects for a protocol version, keyed by section identifier
// for easy lookup in the tagging UI.
export async function getRiskObjectsByVersion(protocolVersionId: string) {
  const objects = await prisma.protocolRiskObject.findMany({
    where: { protocolVersionId },
    orderBy: { taggedAt: "asc" },
  });

  return new Map(objects.map((o) => [o.sectionIdentifier, o]));
}

// Builds the suggestionProvenance Json from form input.
// Records what was suggested vs. what the auditor confirmed, and whether it was overridden.
function buildProvenance(input: CreateRiskObjectInput): SuggestionProvenance {
  const { suggestions, values } = input;
  if (!suggestions) return {};

  const provenance: SuggestionProvenance = {};

  if (suggestions.endpointTier) {
    provenance.endpointTier = {
      suggested: suggestions.endpointTier.suggested,
      confirmed: values.endpointTier,
      overridden: values.endpointTier !== suggestions.endpointTier.suggested,
      source: suggestions.endpointTier.source,
      confidence: suggestions.endpointTier.confidence,
    };
  }

  if (suggestions.impactSurface) {
    provenance.impactSurface = {
      suggested: suggestions.impactSurface.suggested,
      confirmed: values.impactSurface,
      overridden: values.impactSurface !== suggestions.impactSurface.suggested,
      source: suggestions.impactSurface.source,
      confidence: suggestions.impactSurface.confidence,
    };
  }

  if (suggestions.timeSensitivity) {
    provenance.timeSensitivity = {
      suggested: suggestions.timeSensitivity.suggested,
      confirmed: values.timeSensitivity,
      overridden: values.timeSensitivity !== suggestions.timeSensitivity.suggested,
      source: suggestions.timeSensitivity.source,
      confidence: suggestions.timeSensitivity.confidence,
    };
  }

  if (suggestions.vendorDependencyFlags) {
    const suggestedStr = JSON.stringify(suggestions.vendorDependencyFlags.suggested);
    const confirmedStr = JSON.stringify(values.vendorDependencyFlags);
    provenance.vendorDependencyFlags = {
      suggested: suggestions.vendorDependencyFlags.suggested,
      confirmed: values.vendorDependencyFlags,
      overridden: suggestedStr !== confirmedStr,
      source: suggestions.vendorDependencyFlags.source,
      confidence: suggestions.vendorDependencyFlags.confidence,
    };
  }

  if (suggestions.operationalDomainTag) {
    provenance.operationalDomainTag = {
      suggested: suggestions.operationalDomainTag.suggested,
      confirmed: values.operationalDomainTag,
      overridden: values.operationalDomainTag !== suggestions.operationalDomainTag.suggested,
      source: suggestions.operationalDomainTag.source,
      confidence: suggestions.operationalDomainTag.confidence,
    };
  }

  return provenance;
}

// Maps a PIQC section's suggestions into the RiskTagSuggestions shape
// expected by RiskTaggingForm. Call this during ingestion when PIQC provides
// candidate tags. Returns undefined if no suggestions are present.
export function mapPiqcSuggestions(
  suggestions: import("@/lib/types/piqc").PiqcSectionSuggestions | undefined
): import("@/lib/types/risk-tagging").RiskTagSuggestions | undefined {
  if (!suggestions) return undefined;

  const result: import("@/lib/types/risk-tagging").RiskTagSuggestions = {};

  if (suggestions.endpointTier) {
    result.endpointTier = {
      suggested: suggestions.endpointTier,
      source: "piqc",
      confidence: suggestions.confidence,
    };
  }
  if (suggestions.impactSurface) {
    result.impactSurface = {
      suggested: suggestions.impactSurface,
      source: "piqc",
      confidence: suggestions.confidence,
    };
  }
  if (suggestions.timeSensitivity !== undefined) {
    result.timeSensitivity = {
      suggested: suggestions.timeSensitivity,
      source: "piqc",
      confidence: suggestions.confidence,
    };
  }
  if (suggestions.vendorDependencyFlags) {
    result.vendorDependencyFlags = {
      suggested: suggestions.vendorDependencyFlags,
      source: "piqc",
      confidence: suggestions.confidence,
    };
  }
  if (suggestions.operationalDomainTag) {
    result.operationalDomainTag = {
      suggested: suggestions.operationalDomainTag,
      source: "piqc",
      confidence: suggestions.confidence,
    };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// -----------------------------------------------------------------------------
// Stage-level read helper
// Returns the 7-field shape used by VENDOR_ENRICHMENT and SCOPE_AND_RISK_REVIEW
// (VendorRiskObjectShape / ScopeRiskObject). Eliminates the duplicate inline
// prisma.protocolRiskObject.findMany calls in app/audits/[auditId]/page.tsx.
// INTAKE uses a wider select (vendorDependencyFlags + taggingMode); it retains
// its own query.
// -----------------------------------------------------------------------------
export async function getProtocolRiskObjectsForStage(protocolVersionId: string) {
  return prisma.protocolRiskObject.findMany({
    where:   { protocolVersionId },
    orderBy: { taggedAt: "asc" },
    select: {
      id: true,
      sectionIdentifier: true,
      sectionTitle: true,
      endpointTier: true,
      impactSurface: true,
      timeSensitivity: true,
      operationalDomainTag: true,
    },
  });
}
