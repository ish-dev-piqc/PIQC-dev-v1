// =============================================================================
// Vendor service library
//
// Handles VendorServiceObject creation and VendorServiceMappingObject
// create/update, including deterministic criticality derivation.
//
// Criticality is derived from the linked ProtocolRiskObject's fields.
// It is human-editable with a rationale field. It is never LLM-scored.
// All mutations write a StateHistoryDelta in the same transaction.
// =============================================================================

import {
  DerivedCriticality,
  EndpointTier,
  ImpactSurface,
  ProtocolRiskObject,
  TrackedObjectType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { diffFields, writeDelta } from "@/lib/state-history";
import {
  CreateVendorServiceInput,
  CreateServiceMappingInput,
  UpdateServiceMappingInput,
} from "@/lib/types/vendor-service";

// -----------------------------------------------------------------------------
// Criticality derivation
//
// Deterministic, auditor-explainable logic. No LLM involved.
// Base criticality from endpoint_tier × impact_surface, then bumped if
// time_sensitivity is true. Auditor can always override with a rationale.
//
// Derivation table:
//   PRIMARY   × BOTH              → CRITICAL
//   PRIMARY   × PATIENT_SAFETY    → CRITICAL
//   PRIMARY   × DATA_INTEGRITY    → HIGH
//   SAFETY    × BOTH              → CRITICAL
//   SAFETY    × PATIENT_SAFETY    → HIGH
//   SAFETY    × DATA_INTEGRITY    → HIGH
//   SECONDARY × BOTH              → HIGH
//   SECONDARY × PATIENT_SAFETY    → HIGH
//   SECONDARY × DATA_INTEGRITY    → MODERATE
//   SUPPORTIVE × any              → LOW
//   + time_sensitivity = true bumps up one level (LOW→MOD, MOD→HIGH, HIGH→CRIT)
// -----------------------------------------------------------------------------
export function deriveCriticality(risk: Pick<ProtocolRiskObject, "endpointTier" | "impactSurface" | "timeSensitivity">): DerivedCriticality {
  const { endpointTier, impactSurface, timeSensitivity } = risk;

  let base: DerivedCriticality;

  if (endpointTier === EndpointTier.SUPPORTIVE) {
    base = DerivedCriticality.LOW;
  } else if (endpointTier === EndpointTier.SECONDARY) {
    base =
      impactSurface === ImpactSurface.DATA_INTEGRITY
        ? DerivedCriticality.MODERATE
        : DerivedCriticality.HIGH;
  } else if (endpointTier === EndpointTier.SAFETY) {
    base =
      impactSurface === ImpactSurface.BOTH
        ? DerivedCriticality.CRITICAL
        : DerivedCriticality.HIGH;
  } else {
    // PRIMARY
    base =
      impactSurface === ImpactSurface.DATA_INTEGRITY
        ? DerivedCriticality.HIGH
        : DerivedCriticality.CRITICAL;
  }

  if (!timeSensitivity) return base;

  // Bump up one level
  const bump: Record<DerivedCriticality, DerivedCriticality> = {
    LOW: DerivedCriticality.MODERATE,
    MODERATE: DerivedCriticality.HIGH,
    HIGH: DerivedCriticality.CRITICAL,
    CRITICAL: DerivedCriticality.CRITICAL, // already at ceiling
  };
  return bump[base];
}

// Returns a human-readable explanation of the derivation for the rationale field.
// Used as the default criticalityRationale when creating a mapping.
export function buildDefaultRationale(
  risk: Pick<ProtocolRiskObject, "endpointTier" | "impactSurface" | "timeSensitivity">
): string {
  const parts = [
    `${risk.endpointTier.toLowerCase()} endpoint`,
    `${risk.impactSurface.toLowerCase().replace("_", " ")} impact`,
  ];
  if (risk.timeSensitivity) parts.push("time sensitive");
  return `Derived from: ${parts.join(", ")}.`;
}

// -----------------------------------------------------------------------------
// VendorServiceObject
// -----------------------------------------------------------------------------

export async function createVendorService(
  auditId: string,
  input: CreateVendorServiceInput,
  actorId: string
) {
  return prisma.$transaction(async (tx) => {
    const service = await tx.vendorServiceObject.create({
      data: {
        auditId,
        serviceName: input.serviceName,
        serviceType: input.serviceType,
        serviceDescription: input.serviceDescription ?? null,
      },
    });

    await writeDelta(
      tx,
      TrackedObjectType.VENDOR_SERVICE_OBJECT,
      service.id,
      {
        serviceName: { from: null, to: service.serviceName },
        serviceType: { from: null, to: service.serviceType },
        serviceDescription: { from: null, to: service.serviceDescription },
      },
      actorId,
      "Vendor service created"
    );

    return service;
  });
}

export async function getVendorServiceWithMappings(auditId: string) {
  return prisma.vendorServiceObject.findUnique({
    where: { auditId },
    include: {
      mappings: {
        include: {
          protocolRisk: true,
        },
        orderBy: { derivedCriticality: "asc" },
      },
    },
  });
}

// -----------------------------------------------------------------------------
// VendorServiceMappingObject
// -----------------------------------------------------------------------------

export async function createServiceMapping(
  vendorServiceId: string,
  input: CreateServiceMappingInput,
  actorId: string
) {
  return prisma.$transaction(async (tx) => {
    const riskObject = await tx.protocolRiskObject.findUniqueOrThrow({
      where: { id: input.protocolRiskId },
      select: { endpointTier: true, impactSurface: true, timeSensitivity: true },
    });

    const criticality = deriveCriticality(riskObject);
    const rationale =
      input.criticalityRationale ?? buildDefaultRationale(riskObject);

    const mapping = await tx.vendorServiceMappingObject.create({
      data: {
        vendorServiceId,
        protocolRiskId: input.protocolRiskId,
        derivedCriticality: criticality,
        criticalityRationale: rationale,
      },
    });

    await writeDelta(
      tx,
      TrackedObjectType.VENDOR_SERVICE_MAPPING_OBJECT,
      mapping.id,
      {
        protocolRiskId: { from: null, to: mapping.protocolRiskId },
        derivedCriticality: { from: null, to: mapping.derivedCriticality },
        criticalityRationale: { from: null, to: mapping.criticalityRationale },
      },
      actorId,
      "Service mapping created"
    );

    return mapping;
  });
}

export async function updateServiceMapping(
  mappingId: string,
  input: UpdateServiceMappingInput
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.vendorServiceMappingObject.findUniqueOrThrow({
      where: { id: mappingId },
    });

    const patch = {
      ...(input.derivedCriticality !== undefined && {
        derivedCriticality: input.derivedCriticality,
      }),
      ...(input.criticalityRationale !== undefined && {
        criticalityRationale: input.criticalityRationale,
      }),
    };

    const changed = diffFields(
      {
        derivedCriticality: existing.derivedCriticality,
        criticalityRationale: existing.criticalityRationale,
      },
      patch
    );

    const updated = await tx.vendorServiceMappingObject.update({
      where: { id: mappingId },
      data: patch,
    });

    await writeDelta(
      tx,
      TrackedObjectType.VENDOR_SERVICE_MAPPING_OBJECT,
      mappingId,
      changed,
      input.actorId,
      input.reason ?? "Criticality updated by auditor"
    );

    return updated;
  });
}
