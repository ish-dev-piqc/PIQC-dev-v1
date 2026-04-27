// =============================================================================
// Risk tagging — form input/output types
//
// These types define the contract between the RiskTaggingForm component and the
// API routes that create/update ProtocolRiskObjects.
// =============================================================================

import { EndpointTier, ImpactSurface, TaggingMode } from "@prisma/client";

// The confirmed field values an auditor submits.
// These map directly to ProtocolRiskObject fields.
export interface RiskTagFormValues {
  endpointTier: EndpointTier;
  impactSurface: ImpactSurface;
  timeSensitivity: boolean;
  vendorDependencyFlags: string[];
  operationalDomainTag: string;
}

// A suggestion for a single field — what the system proposed before the auditor acted.
export interface FieldSuggestion<T> {
  suggested: T;
  source: "piqc" | "llm";
  confidence?: number; // 0.0–1.0, optional
}

// The full suggestion payload passed into RiskTaggingForm.
// Each field is optional — only suggested fields are included.
// Absent fields render as blank inputs (manual mode).
export interface RiskTagSuggestions {
  endpointTier?: FieldSuggestion<EndpointTier>;
  impactSurface?: FieldSuggestion<ImpactSurface>;
  timeSensitivity?: FieldSuggestion<boolean>;
  vendorDependencyFlags?: FieldSuggestion<string[]>;
  operationalDomainTag?: FieldSuggestion<string>;
}

// What gets stored in ProtocolRiskObject.suggestionProvenance.
// Keyed by field name. Only fields that had a suggestion are present.
// Includes the final auditor value so override rate can be computed later.
export interface SuggestionProvenanceEntry<T> {
  suggested: T;
  confirmed: T;           // What the auditor submitted (may equal suggested if accepted)
  overridden: boolean;    // true if confirmed !== suggested
  source: "piqc" | "llm";
  confidence?: number;
}

export type SuggestionProvenance = {
  endpointTier?: SuggestionProvenanceEntry<EndpointTier>;
  impactSurface?: SuggestionProvenanceEntry<ImpactSurface>;
  timeSensitivity?: SuggestionProvenanceEntry<boolean>;
  vendorDependencyFlags?: SuggestionProvenanceEntry<string[]>;
  operationalDomainTag?: SuggestionProvenanceEntry<string>;
};

// Input to POST /api/protocols/[protocolVersionId]/risk-objects
export interface CreateRiskObjectInput {
  sectionIdentifier: string;
  sectionTitle: string;
  values: RiskTagFormValues;
  suggestions?: RiskTagSuggestions; // Present when taggingMode !== MANUAL
  taggingMode: TaggingMode;
  taggedBy: string; // actor_id — User.id. Replaced by session.user.id when auth is added.
}

// Input to PATCH /api/protocols/[protocolVersionId]/risk-objects/[id]
export interface UpdateRiskObjectInput {
  values: Partial<RiskTagFormValues>;
  actorId: string;
  reason?: string;
}

// What the API returns after create/update — the confirmed object plus tagging context.
export interface RiskObjectResponse {
  id: string;
  protocolVersionId: string;
  sectionIdentifier: string;
  sectionTitle: string;
  endpointTier: EndpointTier;
  impactSurface: ImpactSurface;
  timeSensitivity: boolean;
  vendorDependencyFlags: string[];
  operationalDomainTag: string;
  taggingMode: TaggingMode;
  taggedBy: string;
  taggedAt: string;
}
