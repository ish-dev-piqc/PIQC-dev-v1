// =============================================================================
// Mock VendorRiskSummaryObject data for Phase A.
//
// One entry per mock audit, plus a couple of linked ProtocolRiskObject refs
// for display. Phase B replaces this with a Supabase query against
// vendor_risk_summary_objects + vendor_risk_summary_protocol_risks.
//
// Sponsor-name-free by rule — narratives stay generic.
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

// Keyed by audit_id. `null` = no summary yet → "Generate stub" empty state.
export const MOCK_RISK_SUMMARIES: Record<string, MockRiskSummary | null> = {
  // BRIGHTEN-2 — Phase 3 oncology, full-service CRO. DRAFT state — narrative
  // generated and edited, awaiting approval in SCOPE_AND_RISK_REVIEW.
  'audit-001': {
    id: 'rs-001',
    audit_id: 'audit-001',
    study_context: {
      therapeutic_space: 'Oncology — solid tumors',
      primary_endpoints: ['Overall survival at 24 months'],
      secondary_endpoints: [
        'Progression-free survival',
        'Objective response rate',
        'Safety and tolerability',
      ],
      clinical_trial_phase: 'PHASE_3',
      captured_at: '2026-04-12T14:22:00Z',
    },
    vendor_relevance_narrative:
      "This vendor provides full-service CRO support including data management, biostatistics, and central randomization. Given the Phase 3 design with overall survival as the primary endpoint, audit attention should center on data lifecycle integrity from EDC capture through database lock, central randomization independence, and adherence to the statistical analysis plan. Operational reliance on the CRO spans nearly every protocol-critical function — this is a high-criticality vendor relationship.",
    focus_areas: [
      'Data integrity (EDC, query resolution)',
      'Central randomization independence',
      'eTMF completeness and inspection-readiness',
      'Statistical analysis plan adherence',
    ],
    approval_status: 'DRAFT',
    approved_at: null,
    approved_by_name: null,
    protocol_risk_refs: [
      {
        id: 'pr-001',
        section_identifier: '7.1',
        section_title: 'Primary endpoint analysis',
        operational_domain_tag: 'central_lab',
      },
      {
        id: 'pr-002',
        section_identifier: '5.4',
        section_title: 'Randomization procedures',
        operational_domain_tag: 'IVRS',
      },
      {
        id: 'pr-003',
        section_identifier: '6.2',
        section_title: 'Data management plan',
        operational_domain_tag: 'EDC',
      },
    ],
    created_at: '2026-04-12T14:22:00Z',
    updated_at: '2026-04-22T09:15:00Z',
  },

  // CARDIAC-7 — INTAKE stage. No summary generated yet → empty state.
  'audit-002': null,

  // IMMUNE-14 — Phase 2, ePRO platform. APPROVED — past SCOPE_AND_RISK_REVIEW
  // and in PRE_AUDIT_DRAFTING.
  'audit-003': {
    id: 'rs-003',
    audit_id: 'audit-003',
    study_context: {
      therapeutic_space: 'Autoimmune — rheumatology',
      primary_endpoints: ['Disease activity score reduction at week 24'],
      secondary_endpoints: ['Patient-reported outcomes', 'Safety and tolerability'],
      clinical_trial_phase: 'PHASE_2',
      captured_at: '2026-04-08T11:05:00Z',
    },
    vendor_relevance_narrative:
      "This vendor provides the electronic patient-reported outcome platform. Given that the primary endpoint is a disease activity score derived in part from PRO data, ePRO platform integrity is directly material to endpoint reliability. Audit emphasis should center on 21 CFR Part 11 compliance, audit trail completeness, device provisioning hygiene, and validation of the scoring algorithms running on the platform. Time-sensitive data capture windows make platform availability and outage handling additional points of scrutiny.",
    focus_areas: [
      '21 CFR Part 11 compliance',
      'Audit trail completeness',
      'Device provisioning and hygiene',
      'Scoring algorithm validation',
      'Outage handling and data recovery',
    ],
    approval_status: 'APPROVED',
    approved_at: '2026-04-18T16:42:00Z',
    approved_by_name: 'Kiara Patel',
    protocol_risk_refs: [
      {
        id: 'pr-010',
        section_identifier: '6.1',
        section_title: 'PRO assessment schedule',
        operational_domain_tag: 'ePRO',
      },
      {
        id: 'pr-011',
        section_identifier: '7.2',
        section_title: 'Disease activity score derivation',
        operational_domain_tag: 'ePRO',
      },
    ],
    created_at: '2026-04-08T11:05:00Z',
    updated_at: '2026-04-18T16:42:00Z',
  },
};
