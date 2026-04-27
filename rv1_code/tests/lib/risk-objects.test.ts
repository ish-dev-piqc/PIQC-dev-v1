// =============================================================================
// Tests: lib/risk-objects.ts
//
// Covers all 5 exports:
//   createRiskObject        — DB write + creation delta + provenance
//   updateRiskObject        — diffFields, delta, no-op skip, reason stored
//   getRiskObjectsByVersion — Map keyed by sectionIdentifier
//   mapPiqcSuggestions      — pure transform, no DB
//   getProtocolRiskObjectsForStage — 7-field select shape + ordering
//
// Integration-test pattern: real Postgres test DB, no mocks.
// Factory helpers (createProtocolRiskObject, seedAuditWithContext) bypass the
// library for prerequisite setup; the function under test is always called live.
// =============================================================================

import { describe, expect, it } from "vitest";
import { EndpointTier, ImpactSurface, TaggingMode, TrackedObjectType } from "@prisma/client";
import {
  createRiskObject,
  getRiskObjectsByVersion,
  getProtocolRiskObjectsForStage,
  mapPiqcSuggestions,
  updateRiskObject,
} from "@/lib/risk-objects";
import { prisma } from "@/lib/prisma";
import { createProtocolRiskObject, seedAuditWithContext } from "../helpers/factory";
import type { PiqcSectionSuggestions } from "@/lib/types/piqc";

// =============================================================================
// createRiskObject
// =============================================================================

describe("createRiskObject", () => {
  it("stores all submitted field values on the created object", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();

    const result = await createRiskObject(protocolVersion.id, {
      sectionIdentifier: "§3.2",
      sectionTitle: "Primary Efficacy Endpoint",
      values: {
        endpointTier: EndpointTier.PRIMARY,
        impactSurface: ImpactSurface.DATA_INTEGRITY,
        timeSensitivity: false,
        vendorDependencyFlags: ["data_lock"],
        operationalDomainTag: "central_lab",
      },
      taggingMode: TaggingMode.MANUAL,
      taggedBy: actor.id,
    });

    expect(result.protocolVersionId).toBe(protocolVersion.id);
    expect(result.sectionIdentifier).toBe("§3.2");
    expect(result.sectionTitle).toBe("Primary Efficacy Endpoint");
    expect(result.endpointTier).toBe(EndpointTier.PRIMARY);
    expect(result.impactSurface).toBe(ImpactSurface.DATA_INTEGRITY);
    expect(result.timeSensitivity).toBe(false);
    expect(result.vendorDependencyFlags).toEqual(["data_lock"]);
    expect(result.operationalDomainTag).toBe("central_lab");
    expect(result.taggingMode).toBe(TaggingMode.MANUAL);
    expect(result.taggedBy).toBe(actor.id);
  });

  it("writes a creation delta with all 6 classification fields from null", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();

    const result = await createRiskObject(protocolVersion.id, {
      sectionIdentifier: "§4.1",
      sectionTitle: "Safety Endpoint",
      values: {
        endpointTier: EndpointTier.SAFETY,
        impactSurface: ImpactSurface.PATIENT_SAFETY,
        timeSensitivity: true,
        vendorDependencyFlags: [],
        operationalDomainTag: "ecg",
      },
      taggingMode: TaggingMode.MANUAL,
      taggedBy: actor.id,
    });

    const delta = await prisma.stateHistoryDelta.findFirst({
      where: {
        objectType: TrackedObjectType.PROTOCOL_RISK_OBJECT,
        objectId: result.id,
      },
    });

    expect(delta).not.toBeNull();
    expect(delta!.actorId).toBe(actor.id);

    const fields = delta!.changedFields as Record<string, { from: unknown; to: unknown }>;
    expect(fields.endpointTier.from).toBeNull();
    expect(fields.endpointTier.to).toBe(EndpointTier.SAFETY);
    expect(fields.impactSurface.from).toBeNull();
    expect(fields.timeSensitivity.from).toBeNull();
    expect(fields.timeSensitivity.to).toBe(true);
    expect(fields.taggingMode.from).toBeNull();
    expect(fields.taggingMode.to).toBe(TaggingMode.MANUAL);
  });

  it("stores null suggestionProvenance when no suggestions are supplied", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();

    const result = await createRiskObject(protocolVersion.id, {
      sectionIdentifier: "§5.0",
      sectionTitle: "Exploratory",
      values: {
        endpointTier: EndpointTier.SUPPORTIVE,
        impactSurface: ImpactSurface.DATA_INTEGRITY,
        timeSensitivity: false,
        vendorDependencyFlags: [],
        operationalDomainTag: "imaging",
      },
      taggingMode: TaggingMode.MANUAL,
      taggedBy: actor.id,
    });

    expect(result.suggestionProvenance).toBeNull();
  });

  it("stores provenance with overridden: false when auditor accepts all suggestions", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();

    const result = await createRiskObject(protocolVersion.id, {
      sectionIdentifier: "§6.1",
      sectionTitle: "PK Endpoint",
      values: {
        endpointTier: EndpointTier.SECONDARY,
        impactSurface: ImpactSurface.DATA_INTEGRITY,
        timeSensitivity: false,
        vendorDependencyFlags: [],
        operationalDomainTag: "central_lab",
      },
      suggestions: {
        endpointTier: { suggested: EndpointTier.SECONDARY, source: "piqc", confidence: 0.9 },
        impactSurface: { suggested: ImpactSurface.DATA_INTEGRITY, source: "piqc", confidence: 0.85 },
      },
      taggingMode: TaggingMode.PIQC_ASSISTED,
      taggedBy: actor.id,
    });

    const provenance = result.suggestionProvenance as Record<string, {
      suggested: unknown; confirmed: unknown; overridden: boolean; source: string;
    }>;

    expect(provenance.endpointTier.overridden).toBe(false);
    expect(provenance.endpointTier.confirmed).toBe(EndpointTier.SECONDARY);
    expect(provenance.endpointTier.source).toBe("piqc");
    expect(provenance.impactSurface.overridden).toBe(false);
  });

  it("stores provenance with overridden: true when auditor changes a suggested value", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();

    const result = await createRiskObject(protocolVersion.id, {
      sectionIdentifier: "§6.2",
      sectionTitle: "Override Test",
      values: {
        // Auditor changes PRIMARY → SECONDARY despite the suggestion
        endpointTier: EndpointTier.SECONDARY,
        impactSurface: ImpactSurface.BOTH,
        timeSensitivity: false,
        vendorDependencyFlags: [],
        operationalDomainTag: "central_lab",
      },
      suggestions: {
        endpointTier: { suggested: EndpointTier.PRIMARY, source: "piqc", confidence: 0.75 },
      },
      taggingMode: TaggingMode.PIQC_ASSISTED,
      taggedBy: actor.id,
    });

    const provenance = result.suggestionProvenance as Record<string, {
      suggested: unknown; confirmed: unknown; overridden: boolean;
    }>;

    expect(provenance.endpointTier.overridden).toBe(true);
    expect(provenance.endpointTier.suggested).toBe(EndpointTier.PRIMARY);
    expect(provenance.endpointTier.confirmed).toBe(EndpointTier.SECONDARY);
  });
});

// =============================================================================
// updateRiskObject
// =============================================================================

describe("updateRiskObject", () => {
  it("updates fields and writes a delta with before/after values", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();
    const existing = await createProtocolRiskObject(protocolVersion.id, actor.id, {
      operationalDomainTag: "central_lab",
    });

    const updated = await updateRiskObject(existing.id, {
      values: { operationalDomainTag: "ecg" },
      actorId: actor.id,
      reason: "Reassigned domain after SOP review",
    });

    expect(updated.operationalDomainTag).toBe("ecg");

    const deltas = await prisma.stateHistoryDelta.findMany({
      where: {
        objectType: TrackedObjectType.PROTOCOL_RISK_OBJECT,
        objectId: existing.id,
      },
      orderBy: { createdAt: "asc" },
    });

    // The factory does not call lib — no creation delta. Only the update delta.
    expect(deltas).toHaveLength(1);
    const fields = deltas[0].changedFields as Record<string, { from: unknown; to: unknown }>;
    expect(fields.operationalDomainTag.from).toBe("central_lab");
    expect(fields.operationalDomainTag.to).toBe("ecg");
  });

  it("stores the reason on the delta", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();
    const existing = await createProtocolRiskObject(protocolVersion.id, actor.id, {
      endpointTier: EndpointTier.SECONDARY,
    });

    await updateRiskObject(existing.id, {
      values: { endpointTier: EndpointTier.PRIMARY },
      actorId: actor.id,
      reason: "Sponsor confirmed this is a co-primary endpoint",
    });

    const delta = await prisma.stateHistoryDelta.findFirst({
      where: { objectId: existing.id },
    });

    expect(delta!.reason).toBe("Sponsor confirmed this is a co-primary endpoint");
  });

  it("does not write a delta when submitted values are identical to existing", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();
    const existing = await createProtocolRiskObject(protocolVersion.id, actor.id, {
      endpointTier: EndpointTier.PRIMARY,
      impactSurface: ImpactSurface.BOTH,
    });

    const countBefore = await prisma.stateHistoryDelta.count({
      where: { objectId: existing.id },
    });

    // Re-submit the exact same values — diffFields should produce empty object
    await updateRiskObject(existing.id, {
      values: {
        endpointTier: EndpointTier.PRIMARY,
        impactSurface: ImpactSurface.BOTH,
      },
      actorId: actor.id,
    });

    const countAfter = await prisma.stateHistoryDelta.count({
      where: { objectId: existing.id },
    });

    expect(countAfter).toBe(countBefore);
  });

  it("only includes actually-changed fields in the delta (partial update)", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();
    const existing = await createProtocolRiskObject(protocolVersion.id, actor.id, {
      endpointTier: EndpointTier.SECONDARY,
      impactSurface: ImpactSurface.DATA_INTEGRITY,
    });

    await updateRiskObject(existing.id, {
      // Change only impactSurface; leave endpointTier unchanged
      values: {
        endpointTier: EndpointTier.SECONDARY, // same
        impactSurface: ImpactSurface.BOTH,    // changed
      },
      actorId: actor.id,
    });

    const delta = await prisma.stateHistoryDelta.findFirst({
      where: { objectId: existing.id },
    });

    const fields = delta!.changedFields as Record<string, unknown>;
    expect(fields).not.toHaveProperty("endpointTier");
    expect(fields).toHaveProperty("impactSurface");
  });
});

// =============================================================================
// getRiskObjectsByVersion
// =============================================================================

describe("getRiskObjectsByVersion", () => {
  it("returns an empty Map when no risk objects exist for the version", async () => {
    const { protocolVersion } = await seedAuditWithContext();

    const result = await getRiskObjectsByVersion(protocolVersion.id);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it("returns a Map keyed by sectionIdentifier", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();

    const obj = await createRiskObject(protocolVersion.id, {
      sectionIdentifier: "§2.1",
      sectionTitle: "Primary Endpoint",
      values: {
        endpointTier: EndpointTier.PRIMARY,
        impactSurface: ImpactSurface.BOTH,
        timeSensitivity: false,
        vendorDependencyFlags: [],
        operationalDomainTag: "central_lab",
      },
      taggingMode: TaggingMode.MANUAL,
      taggedBy: actor.id,
    });

    const result = await getRiskObjectsByVersion(protocolVersion.id);

    expect(result.has("§2.1")).toBe(true);
    expect(result.get("§2.1")!.id).toBe(obj.id);
  });

  it("returns all objects for the version, each accessible by its identifier", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();

    const makeInput = (identifier: string, tag: string) => ({
      sectionIdentifier: identifier,
      sectionTitle: `Section ${identifier}`,
      values: {
        endpointTier: EndpointTier.SECONDARY,
        impactSurface: ImpactSurface.DATA_INTEGRITY,
        timeSensitivity: false,
        vendorDependencyFlags: [] as string[],
        operationalDomainTag: tag,
      },
      taggingMode: TaggingMode.MANUAL,
      taggedBy: actor.id,
    });

    await createRiskObject(protocolVersion.id, makeInput("§7.1", "imaging"));
    await createRiskObject(protocolVersion.id, makeInput("§7.2", "ecg"));

    const result = await getRiskObjectsByVersion(protocolVersion.id);

    expect(result.size).toBe(2);
    expect(result.has("§7.1")).toBe(true);
    expect(result.has("§7.2")).toBe(true);
    expect(result.get("§7.1")!.operationalDomainTag).toBe("imaging");
    expect(result.get("§7.2")!.operationalDomainTag).toBe("ecg");
  });
});

// =============================================================================
// mapPiqcSuggestions — pure function, no DB
// =============================================================================

describe("mapPiqcSuggestions", () => {
  it("returns undefined when input is undefined", () => {
    expect(mapPiqcSuggestions(undefined)).toBeUndefined();
  });

  it("returns undefined when the suggestions object has no recognised fields", () => {
    // confidence alone is not a tag suggestion
    const input: PiqcSectionSuggestions = { confidence: 0.5 };
    expect(mapPiqcSuggestions(input)).toBeUndefined();
  });

  it("maps all present fields with source 'piqc' and the supplied confidence", () => {
    const input: PiqcSectionSuggestions = {
      endpointTier: EndpointTier.PRIMARY,
      impactSurface: ImpactSurface.BOTH,
      timeSensitivity: true,
      vendorDependencyFlags: ["sample_chain"],
      operationalDomainTag: "central_lab",
      confidence: 0.9,
    };

    const result = mapPiqcSuggestions(input);

    expect(result).not.toBeUndefined();
    expect(result!.endpointTier).toEqual({ suggested: EndpointTier.PRIMARY, source: "piqc", confidence: 0.9 });
    expect(result!.impactSurface).toEqual({ suggested: ImpactSurface.BOTH, source: "piqc", confidence: 0.9 });
    expect(result!.timeSensitivity).toEqual({ suggested: true, source: "piqc", confidence: 0.9 });
    expect(result!.vendorDependencyFlags).toEqual({
      suggested: ["sample_chain"],
      source: "piqc",
      confidence: 0.9,
    });
    expect(result!.operationalDomainTag).toEqual({
      suggested: "central_lab",
      source: "piqc",
      confidence: 0.9,
    });
  });

  it("maps only the fields that are present — absent fields are not in the result", () => {
    const input: PiqcSectionSuggestions = {
      endpointTier: EndpointTier.SECONDARY,
      // impactSurface, timeSensitivity, vendorDependencyFlags, operationalDomainTag absent
    };

    const result = mapPiqcSuggestions(input);

    expect(result).not.toBeUndefined();
    expect(result!.endpointTier).toBeDefined();
    expect(result!.impactSurface).toBeUndefined();
    expect(result!.timeSensitivity).toBeUndefined();
    expect(result!.vendorDependencyFlags).toBeUndefined();
    expect(result!.operationalDomainTag).toBeUndefined();
  });
});

// =============================================================================
// getProtocolRiskObjectsForStage
// =============================================================================

describe("getProtocolRiskObjectsForStage", () => {
  it("returns an empty array when no risk objects exist for the version", async () => {
    const { protocolVersion } = await seedAuditWithContext();

    const result = await getProtocolRiskObjectsForStage(protocolVersion.id);

    expect(result).toHaveLength(0);
  });

  it("returns the 7-field shape expected by VENDOR_ENRICHMENT and SCOPE_AND_RISK_REVIEW", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();

    await createRiskObject(protocolVersion.id, {
      sectionIdentifier: "§8.1",
      sectionTitle: "Shape Check Section",
      values: {
        endpointTier: EndpointTier.PRIMARY,
        impactSurface: ImpactSurface.PATIENT_SAFETY,
        timeSensitivity: true,
        vendorDependencyFlags: [],
        operationalDomainTag: "imaging",
      },
      taggingMode: TaggingMode.MANUAL,
      taggedBy: actor.id,
    });

    const result = await getProtocolRiskObjectsForStage(protocolVersion.id);

    expect(result).toHaveLength(1);
    const row = result[0];

    // The 7 selected fields must be present
    expect(row).toHaveProperty("id");
    expect(row).toHaveProperty("sectionIdentifier");
    expect(row).toHaveProperty("sectionTitle");
    expect(row).toHaveProperty("endpointTier");
    expect(row).toHaveProperty("impactSurface");
    expect(row).toHaveProperty("timeSensitivity");
    expect(row).toHaveProperty("operationalDomainTag");

    // Fields NOT in the select must be absent
    expect(row).not.toHaveProperty("vendorDependencyFlags");
    expect(row).not.toHaveProperty("taggingMode");
    expect(row).not.toHaveProperty("suggestionProvenance");
    expect(row).not.toHaveProperty("taggedBy");
  });

  it("returns all objects for the protocol version", async () => {
    const { actor, protocolVersion } = await seedAuditWithContext();

    const a = await createRiskObject(protocolVersion.id, {
      sectionIdentifier: "§9.1",
      sectionTitle: "First",
      values: {
        endpointTier: EndpointTier.PRIMARY,
        impactSurface: ImpactSurface.BOTH,
        timeSensitivity: false,
        vendorDependencyFlags: [],
        operationalDomainTag: "central_lab",
      },
      taggingMode: TaggingMode.MANUAL,
      taggedBy: actor.id,
    });

    const b = await createRiskObject(protocolVersion.id, {
      sectionIdentifier: "§9.2",
      sectionTitle: "Second",
      values: {
        endpointTier: EndpointTier.SECONDARY,
        impactSurface: ImpactSurface.DATA_INTEGRITY,
        timeSensitivity: false,
        vendorDependencyFlags: [],
        operationalDomainTag: "ecg",
      },
      taggingMode: TaggingMode.MANUAL,
      taggedBy: actor.id,
    });

    const result = await getProtocolRiskObjectsForStage(protocolVersion.id);
    const ids = result.map((r) => r.id);

    expect(result).toHaveLength(2);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });
});
