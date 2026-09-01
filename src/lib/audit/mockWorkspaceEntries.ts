// =============================================================================
// Workspace-entry shape for the AUDIT_CONDUCT stage (audit_workspace_entry_
// objects rows).
//
// TYPE RULING (PR-3): this IS the canonical real-Supabase display shape —
// the dead AuditWorkspaceEntryObject shell in src/types/audit/objects.ts was
// deleted. The `Mock` prefix / mock* filename are legacy-frozen; see
// mockPreAudit.ts for the full ruling.
//
// One structured observation per entry. Anchored optionally to a protocol
// risk row so risk attributes inherit at link time.
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
  protocol_risk_id: string | null;       // optional link to a protocol risk row
  vendor_service_mapping_id: string | null;
  questionnaire_response_id: string | null;
  checkpoint_ref: string | null;          // auditor freetext: vendor SOP/section cite (SOPs are not parsed)
  vendor_domain: string;                  // free-text e.g. "Validation", "Device hygiene"
  observation_text: string;
  provisional_impact: ProvisionalImpact;
  provisional_classification: ProvisionalClassification;
  // Risk-attr snapshot — populated when protocol_risk_id is linked
  inherited_endpoint_tier: EndpointTier | null;
  inherited_impact_surface: ImpactSurface | null;
  inherited_time_sensitivity: boolean | null;
  // System-written when the linked protocol risk row changes via amendment
  risk_context_outdated: boolean;
  // B2: optional SOTR protocol_extracted_item this finding traces back to.
  // Same trust-act as Stage 1's source link — auditor-attested provenance.
  source_extracted_item_id: string | null;
  created_by_name: string;
  created_at: string;
}
