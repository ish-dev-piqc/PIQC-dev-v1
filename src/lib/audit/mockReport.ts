// =============================================================================
// Mock data for REPORT_DRAFTING + FINAL_REVIEW_EXPORT stages.
//
// The report compiles from upstream stages (questionnaire, workspace entries,
// risk summary, vendor service). Two free-text sections are auditor-authored:
// the executive summary and the conclusions. The rest auto-renders from
// existing mock stores in AuditDataContext.
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
  // Final-export bookkeeping (Stage 8). null until the auditor signs off.
  final_signed_off_at: string | null;
  final_signed_off_by_name: string | null;
  exported_at: string | null;
}

export const MOCK_REPORTS: Record<string, MockReportDraft | null> = {
  'audit-001': null,
  'audit-002': null,
  // IMMUNE-14 — furthest along; report drafted, awaiting auditor approval.
  'audit-003': {
    id: 'rd-003',
    audit_id: 'audit-003',
    executive_summary:
      'This audit reviewed the contracted ePRO platform and patient device fleet against the protocol-defined PRO assessment schedule and disease activity score derivation. The vendor demonstrated strong validation evidence and a current Part 11 conformance posture. One major finding was identified in operational continuity — specifically, single-individual ownership in the outage notification matrix — which the vendor has agreed to remediate within 30 days. One minor observation was noted regarding scoring engine change-control sequencing. Overall trust posture remains High; the contracted services are fit for purpose contingent on the remediation commitment.',
    conclusions:
      'The vendor is recommended as suitable to continue providing ePRO platform and device fleet services for this study, subject to receipt of the updated outage handling SOP referenced in Finding 1. No additional follow-up audit is required at this time. The findings will be tracked through the standard CAPA process; closure timing is captured in the report appendix.',
    approval_status: 'DRAFT',
    approved_at: null,
    approved_by_name: null,
    final_signed_off_at: null,
    final_signed_off_by_name: null,
    exported_at: null,
  },
};
