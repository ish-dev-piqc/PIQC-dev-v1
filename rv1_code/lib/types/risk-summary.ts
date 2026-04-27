// =============================================================================
// VendorRiskSummary types (D-010)
//
// The "secondary decision layer" from the UX design — explains why this vendor
// matters in the context of this study. Generated as a deterministic stub that
// the auditor edits down to fit their judgment (never blank-page).
//
// Sponsor-name-free by rule. Auditors add sponsor branding on export.
// =============================================================================

import { ClinicalTrialPhase, RiskSummaryApprovalStatus } from "@prisma/client";
import { z } from "zod";

// -----------------------------------------------------------------------------
// Study context snapshot
// Copied from ProtocolVersion at risk-summary creation time. Stable across
// protocol amendments — once the auditor approves a risk summary, the study
// context that drove their judgment must not silently change beneath them.
// -----------------------------------------------------------------------------
export interface StudyContextSnapshot {
  therapeuticSpace: string | null;
  primaryEndpoints: string[];
  secondaryEndpoints: string[];
  clinicalTrialPhase: ClinicalTrialPhase;
  capturedAt: string; // ISO8601
}

export const StudyContextSnapshotSchema = z.object({
  therapeuticSpace: z.string().nullable(),
  primaryEndpoints: z.array(z.string()),
  secondaryEndpoints: z.array(z.string()),
  clinicalTrialPhase: z.nativeEnum(ClinicalTrialPhase),
  capturedAt: z.string(),
});

// -----------------------------------------------------------------------------
// Create / get-or-create
// Risk summaries are auto-created with a deterministic stub when the audit
// reaches SCOPE_AND_RISK_REVIEW (or on explicit request). One per audit.
// -----------------------------------------------------------------------------
export interface CreateRiskSummaryStubInput {
  auditId: string;
  actorId: string;
}

export const CreateRiskSummaryStubSchema = z.object({});

// -----------------------------------------------------------------------------
// Update (auditor edits the narrative + focus areas)
// approvalStatus is NOT mutable here — use approveRiskSummary for that gate.
// -----------------------------------------------------------------------------
export interface UpdateRiskSummaryInput {
  auditId: string;
  actorId: string;
  vendorRelevanceNarrative?: string;
  focusAreas?: string[];
}

export const UpdateRiskSummarySchema = z.object({
  vendorRelevanceNarrative: z.string().min(1).optional(),
  focusAreas: z.array(z.string()).optional(),
});

// -----------------------------------------------------------------------------
// Approval — explicit human gate. Once approved, downstream drafting agents
// (confirmation letter, agenda, checklist, report) read this as a stable input.
// -----------------------------------------------------------------------------
export interface ApproveRiskSummaryInput {
  auditId: string;
  actorId: string; // The auditor approving — also written as approvedBy
}

export const ApproveRiskSummarySchema = z.object({});

// -----------------------------------------------------------------------------
// Read shape — what the workspace renders
// -----------------------------------------------------------------------------
export interface RenderedRiskSummary {
  id: string;
  auditId: string;
  studyContext: StudyContextSnapshot;
  vendorRelevanceNarrative: string;
  focusAreas: string[];
  approvalStatus: RiskSummaryApprovalStatus;
  approvedAt: string | null;
  approvedBy: string | null;
  protocolRiskRefs: Array<{
    id: string;
    sectionIdentifier: string;
    sectionTitle: string;
    operationalDomainTag: string;
  }>;
  createdAt: string;
  updatedAt: string;
}
