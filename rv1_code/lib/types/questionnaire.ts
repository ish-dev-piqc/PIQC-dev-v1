// =============================================================================
// Questionnaire types (D-003)
//
// Type contracts for the questionnaire workflow:
//   1. Auditor creates QuestionnaireInstance from canonical template version
//   2. Auditor pre-fills standard questions from public web research
//   3. System generates 5.3.x addendum questions from VendorServiceMappingObject
//   4. Auditor sends instance to vendor (PENDING questions only)
//   5. Vendor responses ingested back as VENDOR-sourced answers
//   6. Auditor reviews + finalizes; export produces a "first draft" doc
// =============================================================================

import {
  ClinicalTrialPhase,
  QuestionAnswerType,
  QuestionnaireInstanceStatus,
  QuestionOrigin,
  ResponseSource,
  ResponseStatus,
} from "@prisma/client";
import { z } from "zod";

// -----------------------------------------------------------------------------
// Template seeding shape
// Used by prisma/seed.ts and any future template editor. Captures the structure
// of the canonical GCP vendor questionnaire seed.
// -----------------------------------------------------------------------------
export interface TemplateQuestionSeed {
  questionNumber: string;        // e.g. "1.1.1"
  sectionCode: string;           // e.g. "1.1"
  sectionTitle: string;          // e.g. "Vendor Background"
  prompt: string;
  answerType: QuestionAnswerType;
  evidenceExpected: boolean;
  domainTag?: string;
  ordinal: number;
}

export interface TemplateSeed {
  slug: string;
  name: string;
  description?: string;
  isDefault: boolean;
  versionNumber: number;
  notes?: string;
  questions: TemplateQuestionSeed[];
}

// -----------------------------------------------------------------------------
// Instance creation
// -----------------------------------------------------------------------------
export interface CreateQuestionnaireInstanceInput {
  auditId: string;
  templateSlug?: string; // Defaults to the canonical default template if omitted
  actorId: string;
  vendorContactName?: string;
  vendorContactEmail?: string;
  vendorContactTitle?: string;
}

export const CreateQuestionnaireInstanceSchema = z.object({
  templateSlug: z.string().optional(),
  vendorContactName: z.string().optional(),
  vendorContactEmail: z.string().email().optional(),
  vendorContactTitle: z.string().optional(),
});

// -----------------------------------------------------------------------------
// Addendum generation
// Triggered by auditor explicitly (not on every mapping write) so the auditor
// has control over when 5.3.x is regenerated.
// -----------------------------------------------------------------------------
export interface GenerateAddendaInput {
  instanceId: string;
  actorId: string;
  // If true, removes existing addendum questions for this instance before regenerating.
  // Default false — incremental generation appends new questions for newly-added mappings.
  replaceExisting?: boolean;
}

export const GenerateAddendaSchema = z.object({
  replaceExisting: z.boolean().optional(),
});

// Addendum rule input — read by the rule table to produce candidate questions.
// All inputs are upstream-derived; the addendum generator never asks the auditor
// to re-enter any of these values.
export interface AddendumRuleInput {
  serviceType: string;            // From VendorServiceObject.serviceType
  derivedCriticality: string;     // From VendorServiceMappingObject.derivedCriticality
  clinicalTrialPhase: ClinicalTrialPhase; // From ProtocolVersion via Audit
  operationalDomainTag: string;   // From ProtocolRiskObject.operationalDomainTag
}

// What the rule table produces. The generator turns these into
// QuestionnaireQuestion rows with origin=ADDENDUM.
export interface AddendumQuestionCandidate {
  prompt: string;
  answerType: QuestionAnswerType;
  evidenceExpected: boolean;
  domainTag: string;
  // Stable rule key for traceability — lets us answer "which rule produced this question?"
  ruleKey: string;
}

// -----------------------------------------------------------------------------
// Response capture (auditor pre-fill or vendor return)
// -----------------------------------------------------------------------------
export interface ResponseCaptureInput {
  instanceId: string;
  questionId: string;
  responseText?: string;
  responseStatus?: ResponseStatus;
  source: ResponseSource;
  sourceReference?: string;       // URL/citation for AUDITOR_PREFILL_WEB
  confidenceFlag?: boolean;
  inconsistencyFlag?: boolean;
  inconsistencyNote?: string;
  vendorServiceMappingId?: string;
  // For auditor-sourced responses, this is a User id. For VENDOR-sourced, leave null.
  respondedBy?: string;
  // actorId always present — who is writing this row right now (auditor performing the action)
  actorId: string;
}

export const ResponseCaptureSchema = z.object({
  questionId: z.string().uuid(),
  responseText: z.string().optional(),
  responseStatus: z.nativeEnum(ResponseStatus).optional(),
  source: z.nativeEnum(ResponseSource),
  sourceReference: z.string().optional(),
  confidenceFlag: z.boolean().optional(),
  inconsistencyFlag: z.boolean().optional(),
  inconsistencyNote: z.string().optional(),
  vendorServiceMappingId: z.string().uuid().optional(),
  respondedBy: z.string().uuid().optional(),
});

// Bulk vendor return — vendor portal (later phase) or a one-shot ingestion
// after vendor returns the questionnaire by email/PDF.
export interface VendorReturnInput {
  instanceId: string;
  actorId: string; // The auditor ingesting the vendor's responses
  responses: Array<{
    questionId: string;
    responseText: string;
    inconsistencyFlag?: boolean;
    inconsistencyNote?: string;
  }>;
}

export const VendorReturnSchema = z.object({
  responses: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        responseText: z.string().min(1),
        inconsistencyFlag: z.boolean().optional(),
        inconsistencyNote: z.string().optional(),
      })
    )
    .min(1, { message: "At least one response is required" }),
});

// -----------------------------------------------------------------------------
// Status transitions
// -----------------------------------------------------------------------------
export interface InstanceStatusTransitionInput {
  instanceId: string;
  toStatus: QuestionnaireInstanceStatus;
  actorId: string;
  reason?: string;
}

export const InstanceStatusTransitionSchema = z.object({
  toStatus: z.nativeEnum(QuestionnaireInstanceStatus),
  reason: z.string().optional(),
});

// -----------------------------------------------------------------------------
// Read shapes — convenience for the workspace UI
// -----------------------------------------------------------------------------
export interface RenderedQuestion {
  id: string;
  origin: QuestionOrigin;
  questionNumber: string;
  sectionCode: string;
  sectionTitle: string;
  prompt: string;
  answerType: QuestionAnswerType;
  evidenceExpected: boolean;
  domainTag: string | null;
  ordinal: number;
  response: {
    id: string;
    responseText: string | null;
    responseStatus: ResponseStatus;
    source: ResponseSource;
    sourceReference: string | null;
    confidenceFlag: boolean;
    inconsistencyFlag: boolean;
    inconsistencyNote: string | null;
  } | null;
}
