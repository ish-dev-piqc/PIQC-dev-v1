import { DerivedCriticality } from "@prisma/client";

export interface CreateVendorServiceInput {
  serviceName: string;
  serviceType: string;
  serviceDescription?: string;
}

export interface CreateServiceMappingInput {
  protocolRiskId: string;
  criticalityRationale?: string;
  // derived_criticality is computed — not supplied by caller
}

export interface UpdateServiceMappingInput {
  derivedCriticality?: DerivedCriticality; // Auditor override of computed value
  criticalityRationale?: string;
  actorId: string;
  reason?: string;
}

// Shared shape for a protocol risk object as used in mapping UI and enrichment workspace
export interface VendorRiskObjectShape {
  id: string;
  sectionIdentifier: string;
  sectionTitle: string;
  endpointTier: string;
  impactSurface: string;
  timeSensitivity: boolean;
  operationalDomainTag: string;
}

// What the mapping panel needs to render each linked risk object
export interface MappingWithRisk {
  mappingId: string;
  derivedCriticality: DerivedCriticality;
  criticalityRationale: string | null;
  riskObject: VendorRiskObjectShape;
}
