// =============================================================================
// Deliverable shapes for the PRE_AUDIT_DRAFTING stage.
//
// TYPE RULING (PR-3, quality review 2026-08-31): these ARE the canonical
// real-Supabase row/display shapes — the parallel "domain object" shells
// that existed for the original trio in src/types/audit/objects.ts were
// dead and have been deleted. The `Mock` prefix and the mock* filename are
// LEGACY-FROZEN (renaming ~380 call sites is churn without payoff): rename
// a module only when a PR is already rewriting it. New domains use real
// names in properly-named modules — D4's FindingsReport first.
//
// Five 1:1 deliverables per audit (D-010 step 7 + PR-D1 + PR-D3): the
// confirmation letter (sent to vendor confirming dates/scope), agenda,
// checklist, internal notification (internal heads-up inviting scope
// input), and evidence gap summary (per-scope-area coverage vs register).
//
// All share the DRAFT/APPROVED lifecycle; editing demotes APPROVED → DRAFT.
// Letter, agenda, and checklist must be APPROVED to unlock AUDIT_CONDUCT; the
// internal notification and evidence gap summary never gate.
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
// Internal notification (PR-D1)
//
// Letter-shaped, deliberately WITHOUT recipients: internal distribution
// happens outside PIQC, and roles-only body text keeps the deliverable
// name-free end to end. Never prefilled (no Stage 3/4 source), never gating.
// -----------------------------------------------------------------------------
export interface MockInternalNotificationContent {
  body_text: string;
  scope: string[];
}

export interface MockInternalNotification {
  id: string;
  audit_id: string;
  content: MockInternalNotificationContent;
  approval_status: DeliverableApprovalStatus;
  approved_by_name: string | null;
  approved_at: string | null;
  // Row version from the touch trigger; approve compare-and-swaps on this.
  updated_at: string;
  // Grounded-generation provenance (PR-D1) — set when drafted/revised by
  // PIQC from protocol + evidence passages.
  generation_refs?: DeliverableGenerationRef[] | null;
  grounding_snapshot?: DeliverableGroundingSnapshot | null;
  generated_at?: string | null;
}

// -----------------------------------------------------------------------------
// Evidence gap summary (PR-D3)
//
// Letter-shaped ({body_text, scope}): a generated document listing, per scope
// area, what evidence is on file in the register and what is outstanding —
// withheld register rows are named as withheld, never silently absent. Never
// prefilled, never gating. `scope` carries the scope-area list covered.
// -----------------------------------------------------------------------------
export interface MockEvidenceGapSummaryContent {
  body_text: string;
  scope: string[];
}

export interface MockEvidenceGapSummary {
  id: string;
  audit_id: string;
  content: MockEvidenceGapSummaryContent;
  approval_status: DeliverableApprovalStatus;
  approved_by_name: string | null;
  approved_at: string | null;
  // Row version from the touch trigger; approve compare-and-swaps on this.
  updated_at: string;
  // Grounded-generation provenance (PR-D3) — set when drafted/revised by
  // PIQC from the register + protocol/evidence passages.
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
  internal_notification: MockInternalNotification | null;
  evidence_gap_summary: MockEvidenceGapSummary | null;
}
