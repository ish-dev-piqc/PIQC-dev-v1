// =============================================================================
// Mock data for VENDOR_ENRICHMENT stage.
//
// Three sub-domains per audit:
//   - VendorServiceObject (1:1 with audit)
//   - VendorServiceMappingObject[] (junctions to ProtocolRiskObjects)
//   - TrustAssessmentObject (1:1 with audit)
//
// Sponsor-name-free by rule.
// =============================================================================

import type {
  CompliancePosture,
  DerivedCriticality,
  MaturityPosture,
  TrustPosture,
} from '../../types/audit';

export interface MockVendorService {
  id: string;
  audit_id: string;
  service_name: string;
  service_type: string;          // controlled vocab — see SERVICE_TYPE_OPTIONS
  service_description: string | null;
}

export interface MockServiceMapping {
  id: string;
  vendor_service_id: string;
  protocol_risk_id: string;       // references mockProtocolRisks entries
  derived_criticality: DerivedCriticality;
  criticality_rationale: string | null;
}

export interface MockTrustAssessment {
  id: string;
  audit_id: string;
  certifications_claimed: string[];
  regulatory_claims: string[];
  compliance_posture: CompliancePosture;
  maturity_posture: MaturityPosture;
  provisional_trust_posture: TrustPosture;
  risk_hypotheses: string[];
  notes: string | null;
}

// -----------------------------------------------------------------------------
// Vendor services — 1 per audit
// -----------------------------------------------------------------------------
export const MOCK_VENDOR_SERVICES: Record<string, MockVendorService | null> = {
  'audit-001': {
    id: 'vs-001',
    audit_id: 'audit-001',
    service_name: 'Full-service CRO oversight',
    service_type: 'cro_full_service',
    service_description:
      'Aurora is contracted as the lead CRO providing data management, biostatistics, central randomization, eTMF custody, and pharmacovigilance support across all participating sites.',
  },
  // CARDIAC-7 is in INTAKE — vendor service not yet defined.
  'audit-002': null,
  'audit-003': {
    id: 'vs-003',
    audit_id: 'audit-003',
    service_name: 'ePRO platform and patient device fleet',
    service_type: 'ePRO',
    service_description:
      'PatientPulse provides the electronic PRO platform, validated scoring engine, and managed device fleet (provisioning, hygiene, replacement) for all enrolled participants.',
  },
};

// -----------------------------------------------------------------------------
// Service mappings — protocol_risk_id values reference mockProtocolRisks ids
// -----------------------------------------------------------------------------
export const MOCK_SERVICE_MAPPINGS: Record<string, MockServiceMapping[]> = {
  'audit-001': [
    {
      id: 'sm-001-01',
      vendor_service_id: 'vs-001',
      protocol_risk_id: 'pr-001-01', // Primary endpoint analysis (OS)
      derived_criticality: 'CRITICAL',
      criticality_rationale:
        'Primary endpoint computation depends on this vendor; deviations directly affect study readout.',
    },
    {
      id: 'sm-001-02',
      vendor_service_id: 'vs-001',
      protocol_risk_id: 'pr-001-02', // Randomization
      derived_criticality: 'HIGH',
      criticality_rationale:
        'Randomization independence and audit trail integrity drive trust in the study assignment.',
    },
    {
      id: 'sm-001-03',
      vendor_service_id: 'vs-001',
      protocol_risk_id: 'pr-001-03', // Data management plan
      derived_criticality: 'HIGH',
      criticality_rationale: 'EDC operations and query resolution sit entirely on this vendor.',
    },
    {
      id: 'sm-001-04',
      vendor_service_id: 'vs-001',
      protocol_risk_id: 'pr-001-04', // AE reporting
      derived_criticality: 'CRITICAL',
      criticality_rationale: 'PV pipeline owned end-to-end by this vendor.',
    },
    {
      id: 'sm-001-05',
      vendor_service_id: 'vs-001',
      protocol_risk_id: 'pr-001-05', // eTMF
      derived_criticality: 'MODERATE',
      criticality_rationale: 'eTMF completeness affects inspection-readiness but not endpoints.',
    },
  ],
  'audit-002': [],
  'audit-003': [
    {
      id: 'sm-003-01',
      vendor_service_id: 'vs-003',
      protocol_risk_id: 'pr-003-01', // PRO assessment schedule
      derived_criticality: 'CRITICAL',
      criticality_rationale: 'Time-sensitive PRO capture is the primary endpoint substrate.',
    },
    {
      id: 'sm-003-02',
      vendor_service_id: 'vs-003',
      protocol_risk_id: 'pr-003-02', // Disease activity score
      derived_criticality: 'CRITICAL',
      criticality_rationale: 'Score derivation runs inside the vendor platform.',
    },
    {
      id: 'sm-003-03',
      vendor_service_id: 'vs-003',
      protocol_risk_id: 'pr-003-03', // Device hygiene SOPs
      derived_criticality: 'MODERATE',
      criticality_rationale: 'Operational hygiene; not direct endpoint material.',
    },
  ],
};

// -----------------------------------------------------------------------------
// Trust assessments — 1 per audit. null = not yet assessed.
// -----------------------------------------------------------------------------
export const MOCK_TRUST_ASSESSMENTS: Record<string, MockTrustAssessment | null> = {
  'audit-001': {
    id: 'ta-001',
    audit_id: 'audit-001',
    certifications_claimed: [
      'ISO 9001:2015',
      'ISO 27001:2022',
      'GCP-trained staff (organisation-wide)',
    ],
    regulatory_claims: [
      'FDA inspection 2024 — no critical findings',
      'EMA QPPV registration current',
    ],
    compliance_posture: 'STRONG',
    maturity_posture: 'MATURE',
    provisional_trust_posture: 'HIGH',
    risk_hypotheses: [
      'Cross-functional handoffs between data management and biostatistics may strain QC turnaround at database lock.',
      'Vendor pivoted to a new EDC tooling stack last year — verify validation evidence is current.',
    ],
    notes:
      'Public materials are detailed; vendor publishes annual quality reports with KPI trend data. No material gaps in initial review.',
  },
  'audit-002': null, // INTAKE stage — not assessed
  'audit-003': {
    id: 'ta-003',
    audit_id: 'audit-003',
    certifications_claimed: ['HITRUST CSF certified', 'SOC 2 Type II'],
    regulatory_claims: [
      '21 CFR Part 11 conformance — self-attested',
      'GDPR DPIA available on request',
    ],
    compliance_posture: 'STRONG',
    maturity_posture: 'MATURE',
    provisional_trust_posture: 'HIGH',
    risk_hypotheses: [
      'Scoring engine versioning — confirm change control discipline given the engine sits on the endpoint critical path.',
      'Device fleet hygiene and replacement SOPs — verify documented, not relied on tribal knowledge.',
    ],
    notes:
      'Vendor publishes a Part 11 white paper that maps platform features to predicate rule requirements — useful starting material for audit prep.',
  },
};
