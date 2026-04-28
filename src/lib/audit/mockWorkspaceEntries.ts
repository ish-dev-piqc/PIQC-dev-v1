// =============================================================================
// Mock data for AUDIT_CONDUCT stage.
//
// AuditWorkspaceEntryObject — one structured observation per entry. Anchored
// optionally to a ProtocolRiskObject so risk attributes inherit at link time.
//
// D-008: only human-governed fields exposed (provisional_impact +
// provisional_classification). No coherence proposals or automated flags.
//
// Sponsor-name-free by rule.
// =============================================================================

import type {
  EndpointTier,
  ImpactSurface,
  ProvisionalClassification,
  ProvisionalImpact,
} from '../../types/audit';

export interface MockWorkspaceEntry {
  id: string;
  audit_id: string;
  protocol_risk_id: string | null;       // optional link to a ProtocolRiskObject
  vendor_service_mapping_id: string | null;
  questionnaire_response_id: string | null;
  checkpoint_ref: string | null;          // [D-004 STUB] plain text
  vendor_domain: string;                  // free-text e.g. "Validation", "Device hygiene"
  observation_text: string;
  provisional_impact: ProvisionalImpact;
  provisional_classification: ProvisionalClassification;
  // Risk-attr snapshot — populated when protocol_risk_id is linked
  inherited_endpoint_tier: EndpointTier | null;
  inherited_impact_surface: ImpactSurface | null;
  inherited_time_sensitivity: boolean | null;
  // System-written when the linked ProtocolRiskObject changes via amendment
  risk_context_outdated: boolean;
  created_by_name: string;
  created_at: string;
}

// Three audits — only IMMUNE-14 has entries seeded (it's mid-conduct in
// the demo flow).
export const MOCK_WORKSPACE_ENTRIES: Record<string, MockWorkspaceEntry[]> = {
  'audit-001': [],
  'audit-002': [],
  'audit-003': [
    {
      id: 'we-003-1',
      audit_id: 'audit-003',
      protocol_risk_id: 'pr-003-01', // PRO assessment schedule
      vendor_service_mapping_id: 'sm-003-01',
      questionnaire_response_id: null,
      checkpoint_ref: '[D-004 STUB] SOP-VAL-001 §2.3',
      vendor_domain: 'Platform validation',
      observation_text:
        'Validation master plan signed and current; revision history shows quarterly review cadence consistent with the SOP. No issues observed.',
      provisional_impact: 'NONE',
      provisional_classification: 'NOT_YET_CLASSIFIED',
      inherited_endpoint_tier: 'PRIMARY',
      inherited_impact_surface: 'DATA_INTEGRITY',
      inherited_time_sensitivity: true,
      risk_context_outdated: false,
      created_by_name: 'Kiara Patel',
      created_at: '2026-04-27T09:42:00Z',
    },
    {
      id: 'we-003-2',
      audit_id: 'audit-003',
      protocol_risk_id: 'pr-003-02', // Disease activity score derivation
      vendor_service_mapping_id: 'sm-003-02',
      questionnaire_response_id: null,
      checkpoint_ref: '[D-004 STUB] SOP-VAL-001 §4.1',
      vendor_domain: 'Scoring engine change control',
      observation_text:
        "Last three production releases of the scoring engine include UAT sign-off and IQ/OQ documentation. One release in February shows IQ run before validation environment refresh — vendor acknowledged the sequence error and confirmed it didn't affect production data integrity.",
      provisional_impact: 'MINOR',
      provisional_classification: 'OBSERVATION',
      inherited_endpoint_tier: 'PRIMARY',
      inherited_impact_surface: 'DATA_INTEGRITY',
      inherited_time_sensitivity: false,
      risk_context_outdated: false,
      created_by_name: 'Kiara Patel',
      created_at: '2026-04-27T11:15:00Z',
    },
    {
      id: 'we-003-3',
      audit_id: 'audit-003',
      protocol_risk_id: null,
      vendor_service_mapping_id: null,
      questionnaire_response_id: null,
      checkpoint_ref: '[D-004 STUB] SOP-OPS-014',
      vendor_domain: 'Outage handling',
      observation_text:
        'Outage handling SOP reviewed during walkthrough. Step ownership is documented but the notification matrix relies on a single individual — no documented backup contact. Vendor agreed to update the SOP within 30 days and confirm backup ownership.',
      provisional_impact: 'MAJOR',
      provisional_classification: 'FINDING',
      inherited_endpoint_tier: null,
      inherited_impact_surface: null,
      inherited_time_sensitivity: null,
      risk_context_outdated: false,
      created_by_name: 'Kiara Patel',
      created_at: '2026-04-27T14:22:00Z',
    },
  ],
};
