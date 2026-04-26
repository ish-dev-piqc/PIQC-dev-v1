// =============================================================================
// PIQC → Vendor PIQC integration types
//
// D-009 OPEN — all field names, types, and shapes below are PROVISIONAL.
// They must be confirmed against the actual PIQC API output before this
// integration goes live. Field names marked [PIQC] will likely change.
//
// Design intent: the PIQC ingest endpoint accepts this shape. Suggestions
// from PIQC (candidate tag values per section) are optional — the system
// works without them (falls back to Phase 1 manual mode).
// =============================================================================

import { EndpointTier, ImpactSurface } from "@prisma/client";

// Candidate tag values PIQC may optionally provide per section.
// When present, these are shown to the auditor as pre-filled suggestions.
// The auditor may confirm, edit, or clear each field independently.
// [PIQC] D-009: confirm whether PIQC will send this at all, and if so,
// which fields it can suggest. May be a subset of what is shown here.
export interface PiqcSectionSuggestions {
  endpointTier?: EndpointTier;           // [PIQC] TBD
  impactSurface?: ImpactSurface;         // [PIQC] TBD
  timeSensitivity?: boolean;             // [PIQC] TBD
  vendorDependencyFlags?: string[];      // [PIQC] TBD
  operationalDomainTag?: string;         // [PIQC] TBD
  confidence?: number;                   // [PIQC] 0.0–1.0 if PIQC provides confidence scores
}

// One section from the PIQC-parsed protocol.
// [PIQC] D-009: confirm identifier format (numeric ID, slug, hierarchy path, etc.),
// whether content text is included, and the exact field names used.
export interface PiqcSection {
  identifier: string;                    // [PIQC] Section key. Format TBD.
  title: string;                         // [PIQC] Section title. Field name TBD.
  content?: string;                      // [PIQC] Section text, if PIQC includes it. Optional.
  suggestions?: PiqcSectionSuggestions;  // [PIQC] Candidate tags. Optional — absent in Phase 1.
}

// Top-level payload shape sent by PIQC to POST /api/protocols/ingest.
// [PIQC] D-009: confirm all field names and whether study-level metadata
// (studyNumber, sponsor, title) is included in this payload or sent separately.
export interface PiqcIngestPayload {
  piqcProtocolId: string;   // [PIQC] PIQC's own identifier for this version. Format TBD.
  studyNumber?: string;     // [PIQC] Trial registration number (e.g. NCT number). Optional — may not be in every payload.
  title: string;            // [PIQC] Protocol title. Field name TBD.
  sponsor: string;          // [PIQC] Sponsor organization. Field name TBD.
  amendmentLabel?: string;  // [PIQC] Amendment label if applicable (e.g. "Amendment 2"). Optional.
  effectiveDate?: string;   // [PIQC] ISO date string (YYYY-MM-DD) if applicable. Optional.
  sections: PiqcSection[];  // [PIQC] Ordered list of protocol sections.
}

// Zod schema for runtime validation at the ingest API boundary.
// Field names here must stay in sync with PiqcIngestPayload above.
// When D-009 is resolved, update both the interface and this schema together.
import { z } from "zod";

const PiqcSectionSuggestionsSchema = z.object({
  endpointTier: z.enum(["PRIMARY", "SECONDARY", "SAFETY", "SUPPORTIVE"]).optional(),
  impactSurface: z.enum(["DATA_INTEGRITY", "PATIENT_SAFETY", "BOTH"]).optional(),
  timeSensitivity: z.boolean().optional(),
  vendorDependencyFlags: z.array(z.string()).optional(),
  operationalDomainTag: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const PiqcSectionSchema = z.object({
  identifier: z.string().min(1),
  title: z.string().min(1),
  content: z.string().optional(),
  suggestions: PiqcSectionSuggestionsSchema.optional(),
});

export const PiqcIngestPayloadSchema = z.object({
  piqcProtocolId: z.string().min(1),
  studyNumber: z.string().optional(),
  title: z.string().min(1),
  sponsor: z.string().min(1),
  amendmentLabel: z.string().optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sections: z.array(PiqcSectionSchema).min(1),
});

export type ValidatedPiqcPayload = z.infer<typeof PiqcIngestPayloadSchema>;
