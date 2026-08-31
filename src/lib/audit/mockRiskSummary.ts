// =============================================================================
// VendorRiskSummaryObject display shapes.
//
// Backed by vendor_risk_summary_objects + vendor_risk_summary_protocol_risks
// in Supabase (see riskSummaryApi.ts).
//
// Sponsor-name-free by rule.
// =============================================================================

import type {
  RiskSummaryApprovalStatus,
  RiskSummaryStudyContext,
} from '../../types/audit';

export interface MockProtocolRiskRef {
  id: string;
  section_identifier: string;
  section_title: string;
  operational_domain_tag: string;
}

export interface MockRiskSummary {
  id: string;
  audit_id: string;
  study_context: RiskSummaryStudyContext;
  vendor_relevance_narrative: string;
  focus_areas: string[];
  approval_status: RiskSummaryApprovalStatus;
  approved_at: string | null;
  approved_by_name: string | null; // mock display only — Phase B reads from user_profiles
  protocol_risk_refs: MockProtocolRiskRef[];
  created_at: string;
  updated_at: string;
}
