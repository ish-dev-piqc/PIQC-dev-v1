// =============================================================================
// Audit workspace entry types
//
// AuditWorkspaceEntryObject is the core observation record for AUDIT_CONDUCT.
// Each entry captures one auditor observation, linked to a vendor domain and
// optionally to a protocol risk section, service mapping, and questionnaire
// response. Risk attributes are copied at creation time (snapshot) so the
// entry remains stable if upstream risk objects change.
//
// D-008 (decided 2026-04-26): Phase 1 exposes human-governed classification
// fields only. No coherence scoring or automated proposals.
// D-004 (stub): checkpointRef is free text in Phase 1; Phase 2 replaces with FK.
// =============================================================================

import {
  DerivedCriticality,
  EndpointTier,
  ImpactSurface,
  ProvisionalClassification,
  ProvisionalImpact,
} from "@prisma/client";
import { z } from "zod";

// -----------------------------------------------------------------------------
// Input schemas
// -----------------------------------------------------------------------------

export const CreateWorkspaceEntrySchema = z.object({
  vendorDomain:            z.string().min(1),
  observationText:         z.string().min(1),
  provisionalImpact:       z.nativeEnum(ProvisionalImpact).optional(),
  provisionalClassification: z.nativeEnum(ProvisionalClassification).optional(),
  checkpointRef:           z.string().optional(),
  protocolRiskId:          z.string().uuid().optional(),
  vendorServiceMappingId:  z.string().uuid().optional(),
  questionnaireResponseId: z.string().uuid().optional(),
});

export interface CreateWorkspaceEntryInput extends z.infer<typeof CreateWorkspaceEntrySchema> {
  actorId: string;
}

export const UpdateWorkspaceEntrySchema = z.object({
  observationText:         z.string().min(1).optional(),
  provisionalImpact:       z.nativeEnum(ProvisionalImpact).optional(),
  provisionalClassification: z.nativeEnum(ProvisionalClassification).optional(),
  checkpointRef:           z.string().optional(),
  reason:                  z.string().optional(),
}).refine(
  (d) =>
    d.observationText !== undefined ||
    d.provisionalImpact !== undefined ||
    d.provisionalClassification !== undefined ||
    d.checkpointRef !== undefined,
  { message: "At least one field must be provided for update" }
);

export interface UpdateWorkspaceEntryInput extends z.infer<typeof UpdateWorkspaceEntrySchema> {
  actorId: string;
}

export const ConfirmRiskContextSchema = z.object({});

export interface ConfirmRiskContextInput {
  actorId: string;
}

// -----------------------------------------------------------------------------
// Rendered shape returned to UI
// -----------------------------------------------------------------------------

export interface LinkedRiskSection {
  id:                   string;
  sectionIdentifier:    string;
  sectionTitle:         string;
}

export interface LinkedServiceMapping {
  id:                 string;
  derivedCriticality: DerivedCriticality;
}

export interface RenderedWorkspaceEntry {
  id:                       string;
  auditId:                  string;
  vendorDomain:             string;
  observationText:          string;
  provisionalImpact:        ProvisionalImpact;
  provisionalClassification: ProvisionalClassification;
  checkpointRef:            string | null;

  // Risk attribute snapshot — copied from ProtocolRiskObject at creation
  riskAttrsInherited:       boolean;
  inheritedEndpointTier:    EndpointTier | null;
  inheritedImpactSurface:   ImpactSurface | null;
  inheritedTimeSensitivity: boolean | null;

  // Amendment flagging (system-written)
  riskContextOutdated:      boolean;
  riskContextConfirmedAt:   string | null; // ISO string

  // Optional structural links
  protocolRisk:             LinkedRiskSection | null;
  vendorServiceMapping:     LinkedServiceMapping | null;
  questionnaireResponseId:  string | null;

  // Provenance
  createdBy:   string;
  creatorName: string;
  createdAt:   string; // ISO string
  updatedAt:   string; // ISO string
}
