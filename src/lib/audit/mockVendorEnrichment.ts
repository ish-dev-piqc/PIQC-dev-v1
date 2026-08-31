// =============================================================================
// Vendor-enrichment shapes for VENDOR_ENRICHMENT stage.
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
  protocol_risk_id: string;       // references ProtocolRiskObject (TaggedSection) ids
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
