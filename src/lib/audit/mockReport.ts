// =============================================================================
// Report-draft shape for REPORT_DRAFTING + FINAL_REVIEW_EXPORT stages.
//
// The report compiles from upstream stages (questionnaire, workspace entries,
// risk summary, vendor service). Two free-text sections are auditor-authored:
// the executive summary and the conclusions. The rest auto-renders from the
// upstream stores in AuditDataContext.
//
// Sponsor-name-free by rule.
// =============================================================================

import type { DeliverableApprovalStatus } from '../../types/audit';

export interface MockReportDraft {
  id: string;
  audit_id: string;
  executive_summary: string;
  conclusions: string;
  approval_status: DeliverableApprovalStatus;
  approved_at: string | null;
  approved_by_name: string | null;
  // Row version from the touch trigger. Approve compare-and-swaps on this so
  // the readiness latch attests to the exact content the reviewer saw.
  updated_at: string;
  // Final-export bookkeeping (Stage 8). null until the auditor signs off.
  final_signed_off_at: string | null;
  final_signed_off_by_name: string | null;
  exported_at: string | null;
  // Prefill provenance — set when the report was agent-bootstrapped from
  // approved Stage 4 risk summary + Stage 6 workspace entries.
  source_risk_summary_id?: string | null;
  prefilled_at?: string | null;
  // Exec-summary provenance. 'templated' = PR #62 SQL scaffold; 'llm' = LLM-
  // drafted via /functions/v1/audit-summary; 'auditor_edited' = auditor has
  // modified the text. Optional only for backward compat; server defaults to
  // 'templated' so every freshly-fetched row should always have a value.
  executive_summary_source?: 'templated' | 'llm' | 'auditor_edited';
  // Conclusions provenance — same shape, independent lifecycle from exec
  // summary. Auditor can accept the LLM exec summary while rewriting the
  // conclusions, or vice versa; each field tracks its own trail.
  conclusions_source?: 'templated' | 'llm' | 'auditor_edited';
}
