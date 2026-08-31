// =============================================================================
// Deliverable shapes for the PRE_AUDIT_DRAFTING stage.
//
// Three 1:1 deliverables per audit (D-010 step 7):
//   - ConfirmationLetterObject — sent to vendor confirming dates/scope
//   - AgendaObject              — multi-day audit plan
//   - ChecklistObject           — auditor's working checklist
//
// All three share the DRAFT/APPROVED lifecycle; editing demotes APPROVED → DRAFT.
// All three must be APPROVED to unlock AUDIT_CONDUCT.
//
// Sponsor-name-free by rule.
// =============================================================================

import type {
  DeliverableGenerationRef,
  DeliverableGroundingSnapshot,
  DeliverableApprovalStatus,
} from '../../types/audit';

// -----------------------------------------------------------------------------
// Confirmation letter
// -----------------------------------------------------------------------------
export interface MockConfirmationLetterContent {
  body_text: string;
  recipients: string[];
  scope: string[];
}

export interface MockConfirmationLetter {
  id: string;
  audit_id: string;
  content: MockConfirmationLetterContent;
  approval_status: DeliverableApprovalStatus;
  approved_by_name: string | null;
  approved_at: string | null;
  // Row version from the touch trigger; approve compare-and-swaps on this.
  updated_at: string;
  // Prefill provenance — set when the deliverable was agent-bootstrapped from
  // approved Stage 3 + Stage 4 context.
  source_risk_summary_id?: string | null;
  source_questionnaire_instance_id?: string | null;
  prefilled_at?: string | null;
  // Grounded-generation provenance (PR-C2) — set when drafted/revised by
  // PIQC from protocol + evidence passages.
  generation_refs?: DeliverableGenerationRef[] | null;
  grounding_snapshot?: DeliverableGroundingSnapshot | null;
  generated_at?: string | null;
}

// -----------------------------------------------------------------------------
// Agenda
// -----------------------------------------------------------------------------
export interface MockAgendaItem {
  id: string;
  time: string;        // e.g. "09:00 – 10:00"
  topic: string;
  owner: string;       // e.g. "Auditor", "Vendor QA Lead"
  notes: string | null;
}

export interface MockAgendaContent {
  items: MockAgendaItem[];
}

export interface MockAgenda {
  id: string;
  audit_id: string;
  content: MockAgendaContent;
  approval_status: DeliverableApprovalStatus;
  approved_by_name: string | null;
  approved_at: string | null;
  // Row version from the touch trigger; approve compare-and-swaps on this.
  updated_at: string;
  // Prefill provenance — set when the deliverable was agent-bootstrapped from
  // the approved Stage 4 risk summary.
  source_risk_summary_id?: string | null;
  prefilled_at?: string | null;
  // Grounded-generation provenance (PR-C2) — set when drafted/revised by
  // PIQC from protocol + evidence passages.
  generation_refs?: DeliverableGenerationRef[] | null;
  grounding_snapshot?: DeliverableGroundingSnapshot | null;
  generated_at?: string | null;
}

// -----------------------------------------------------------------------------
// Checklist
// -----------------------------------------------------------------------------
export interface MockChecklistItem {
  id: string;
  prompt: string;
  checkpoint_ref: string | null;   // auditor freetext: vendor SOP/section cite (SOPs are not parsed)
  evidence_expected: boolean;
}

export interface MockChecklistContent {
  items: MockChecklistItem[];
}

export interface MockChecklist {
  id: string;
  audit_id: string;
  content: MockChecklistContent;
  approval_status: DeliverableApprovalStatus;
  approved_by_name: string | null;
  approved_at: string | null;
  // Row version from the touch trigger; approve compare-and-swaps on this.
  updated_at: string;
  // Prefill provenance — set when the deliverable was agent-bootstrapped from
  // the approved Stage 3 questionnaire.
  source_questionnaire_instance_id?: string | null;
  prefilled_at?: string | null;
  // Grounded-generation provenance (PR-C1) — set when the checklist was
  // drafted/revised by PIQC from protocol + evidence passages.
  generation_refs?: DeliverableGenerationRef[] | null;
  grounding_snapshot?: DeliverableGroundingSnapshot | null;
  generated_at?: string | null;
}

// -----------------------------------------------------------------------------
// Per-audit bundle
// -----------------------------------------------------------------------------
export interface MockPreAuditBundle {
  confirmation_letter: MockConfirmationLetter | null;
  agenda: MockAgenda | null;
  checklist: MockChecklist | null;
}
