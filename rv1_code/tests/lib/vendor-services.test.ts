// =============================================================================
// Tests: lib/vendor-services.ts
//
// Covers two surfaces:
//   1. deriveCriticality — pure deterministic table; no DB required
//   2. DB lifecycle: createVendorService, createServiceMapping,
//      updateServiceMapping, getVendorServiceWithMappings
//
// The derivation table is the highest-risk logic in this file — a silent
// table mismatch would flow through to questionnaire addenda scope and
// audit risk framing. Every row in the lookup table is exercised.
// =============================================================================

import { describe, expect, it } from "vitest";
import { DerivedCriticality, EndpointTier, ImpactSurface } from "@prisma/client";
import {
  createServiceMapping,
  createVendorService,
  deriveCriticality,
  getVendorServiceWithMappings,
  updateServiceMapping,
} from "@/lib/vendor-services";
import { prisma } from "@/lib/prisma";
import {
  createProtocolRiskObject,
  seedAuditWithVendorService,
  seedAuditWithContext,
} from "../helpers/factory";

// =============================================================================
// deriveCriticality — pure function, full table coverage
// =============================================================================

describe("deriveCriticality — base table", () => {
  it.each<[EndpointTier, ImpactSurface, DerivedCriticality]>([
    [EndpointTier.PRIMARY,   ImpactSurface.BOTH,             DerivedCriticality.CRITICAL],
    [EndpointTier.PRIMARY,   ImpactSurface.PATIENT_SAFETY,   DerivedCriticality.CRITICAL],
    [EndpointTier.PRIMARY,   ImpactSurface.DATA_INTEGRITY,   DerivedCriticality.HIGH],
    [EndpointTier.SAFETY,    ImpactSurface.BOTH,             DerivedCriticality.CRITICAL],
    [EndpointTier.SAFETY,    ImpactSurface.PATIENT_SAFETY,   DerivedCriticality.HIGH],
    [EndpointTier.SAFETY,    ImpactSurface.DATA_INTEGRITY,   DerivedCriticality.HIGH],
    [EndpointTier.SECONDARY, ImpactSurface.BOTH,             DerivedCriticality.HIGH],
    [EndpointTier.SECONDARY, ImpactSurface.PATIENT_SAFETY,   DerivedCriticality.HIGH],
    [EndpointTier.SECONDARY, ImpactSurface.DATA_INTEGRITY,   DerivedCriticality.MODERATE],
    [EndpointTier.SUPPORTIVE, ImpactSurface.BOTH,            DerivedCriticality.LOW],
    [EndpointTier.SUPPORTIVE, ImpactSurface.PATIENT_SAFETY,  DerivedCriticality.LOW],
    [EndpointTier.SUPPORTIVE, ImpactSurface.DATA_INTEGRITY,  DerivedCriticality.LOW],
  ])("%s × %s → %s", (endpointTier, impactSurface, expected) => {
    expect(
      deriveCriticality({ endpointTier, impactSurface, timeSensitivity: false })
    ).toBe(expected);
  });
});

describe("deriveCriticality — time_sensitivity bump", () => {
  it("bumps LOW → MODERATE when time-sensitive", () => {
    expect(
      deriveCriticality({
        endpointTier: EndpointTier.SUPPORTIVE,
        impactSurface: ImpactSurface.BOTH,
        timeSensitivity: true,
      })
    ).toBe(DerivedCriticality.MODERATE);
  });

  it("bumps MODERATE → HIGH when time-sensitive", () => {
    expect(
      deriveCriticality({
        endpointTier: EndpointTier.SECONDARY,
        impactSurface: ImpactSurface.DATA_INTEGRITY,
        timeSensitivity: true,
      })
    ).toBe(DerivedCriticality.HIGH);
  });

  it("bumps HIGH → CRITICAL when time-sensitive", () => {
    expect(
      deriveCriticality({
        endpointTier: EndpointTier.PRIMARY,
        impactSurface: ImpactSurface.DATA_INTEGRITY,
        timeSensitivity: true,
      })
    ).toBe(DerivedCriticality.CRITICAL);
  });

  it("does not exceed CRITICAL ceiling when already CRITICAL", () => {
    expect(
      deriveCriticality({
        endpointTier: EndpointTier.PRIMARY,
        impactSurface: ImpactSurface.BOTH,
        timeSensitivity: true,
      })
    ).toBe(DerivedCriticality.CRITICAL);
  });
});

// =============================================================================
// createVendorService
// =============================================================================

describe("createVendorService", () => {
  it("creates the service and writes a delta", async () => {
    const { audit, actor } = await seedAuditWithContext();

    const service = await createVendorService(
      audit.id,
      { serviceName: "Central Lab", serviceType: "central_lab" },
      actor.id
    );

    expect(service.auditId).toBe(audit.id);
    expect(service.serviceName).toBe("Central Lab");

    const delta = await prisma.stateHistoryDelta.findFirst({
      where: { objectId: service.id },
    });
    expect(delta).not.toBeNull();
    expect(delta?.actorId).toBe(actor.id);
  });

  it("stores an optional serviceDescription", async () => {
    const { audit, actor } = await seedAuditWithContext();
    const service = await createVendorService(
      audit.id,
      { serviceName: "ECG", serviceType: "ECG", serviceDescription: "12-lead ECG reading" },
      actor.id
    );
    expect(service.serviceDescription).toBe("12-lead ECG reading");
  });
});

// =============================================================================
// getVendorServiceWithMappings
// =============================================================================

describe("getVendorServiceWithMappings", () => {
  it("returns null when no service exists for the audit", async () => {
    const { audit } = await seedAuditWithContext();
    const result = await getVendorServiceWithMappings(audit.id);
    expect(result).toBeNull();
  });

  it("returns the service with an empty mappings array before any links", async () => {
    const { audit, vendorService } = await seedAuditWithVendorService();
    const result = await getVendorServiceWithMappings(audit.id);
    expect(result?.id).toBe(vendorService.id);
    expect(result?.mappings).toHaveLength(0);
  });
});

// =============================================================================
// createServiceMapping
// =============================================================================

describe("createServiceMapping", () => {
  it("derives criticality from the risk object and writes a delta", async () => {
    const { audit, actor, vendorService, protocolVersion } =
      await seedAuditWithVendorService();

    const risk = await createProtocolRiskObject(
      protocolVersion.id,
      actor.id,
      { endpointTier: EndpointTier.PRIMARY, impactSurface: ImpactSurface.BOTH }
    );

    const mapping = await createServiceMapping(
      vendorService.id,
      { protocolRiskId: risk.id },
      actor.id
    );

    expect(mapping.derivedCriticality).toBe(DerivedCriticality.CRITICAL);

    const delta = await prisma.stateHistoryDelta.findFirst({
      where: { objectId: mapping.id },
    });
    expect(delta?.actorId).toBe(actor.id);
  });

  it("uses caller-supplied rationale instead of the default", async () => {
    const { actor, vendorService, protocolVersion } = await seedAuditWithVendorService();
    const risk = await createProtocolRiskObject(protocolVersion.id, actor.id);

    const mapping = await createServiceMapping(
      vendorService.id,
      { protocolRiskId: risk.id, criticalityRationale: "Custom justification" },
      actor.id
    );

    expect(mapping.criticalityRationale).toBe("Custom justification");
  });

  it("mapping appears in getVendorServiceWithMappings result", async () => {
    const { audit, actor, vendorService, protocolVersion } =
      await seedAuditWithVendorService();
    const risk = await createProtocolRiskObject(protocolVersion.id, actor.id);

    await createServiceMapping(vendorService.id, { protocolRiskId: risk.id }, actor.id);

    const result = await getVendorServiceWithMappings(audit.id);
    expect(result?.mappings).toHaveLength(1);
    expect(result?.mappings[0].protocolRisk.id).toBe(risk.id);
  });
});

// =============================================================================
// updateServiceMapping
// =============================================================================

describe("updateServiceMapping", () => {
  it("overrides criticality and records a delta", async () => {
    const { actor, vendorService, protocolVersion } = await seedAuditWithVendorService();
    const risk = await createProtocolRiskObject(
      protocolVersion.id,
      actor.id,
      { endpointTier: EndpointTier.SUPPORTIVE }
    );
    const mapping = await createServiceMapping(
      vendorService.id,
      { protocolRiskId: risk.id },
      actor.id
    );
    expect(mapping.derivedCriticality).toBe(DerivedCriticality.LOW);

    const updated = await updateServiceMapping(mapping.id, {
      derivedCriticality: DerivedCriticality.HIGH,
      criticalityRationale: "Override: vendor is sole supplier for PK sampling",
      actorId: actor.id,
      reason: "Auditor override",
    });

    expect(updated.derivedCriticality).toBe(DerivedCriticality.HIGH);

    const deltas = await prisma.stateHistoryDelta.findMany({
      where: { objectId: mapping.id },
      orderBy: { createdAt: "asc" },
    });
    // First delta: creation. Second delta: override.
    expect(deltas).toHaveLength(2);
    const overrideDelta = deltas[1];
    expect((overrideDelta.changedFields as Record<string, unknown>).derivedCriticality).toBeDefined();
  });

  it("does not write a delta when no fields actually change", async () => {
    const { actor, vendorService, protocolVersion } = await seedAuditWithVendorService();
    const risk = await createProtocolRiskObject(protocolVersion.id, actor.id);
    const mapping = await createServiceMapping(
      vendorService.id,
      { protocolRiskId: risk.id, criticalityRationale: "Same text" },
      actor.id
    );

    const deltasBefore = await prisma.stateHistoryDelta.count({
      where: { objectId: mapping.id },
    });

    // Patch with identical values — diffFields should yield empty, writeDelta skips
    await updateServiceMapping(mapping.id, {
      derivedCriticality: mapping.derivedCriticality,
      criticalityRationale: "Same text",
      actorId: actor.id,
    });

    const deltasAfter = await prisma.stateHistoryDelta.count({
      where: { objectId: mapping.id },
    });
    expect(deltasAfter).toBe(deltasBefore);
  });
});
