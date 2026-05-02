import { supabase } from '../supabase';
import type {
  MockVendorService,
  MockServiceMapping,
  MockTrustAssessment,
} from './mockVendorEnrichment';
import type {
  CompliancePosture,
  DerivedCriticality,
  MaturityPosture,
  TrustPosture,
} from '../../types/audit';

// =============================================================================
// Vendor Enrichment (Stage 2) API
//
// Reads: direct SELECT (RLS enforces visibility).
// Writes: RPCs in supabase/migrations/20260430140000_audit_mode_vendor_enrichment_rpcs.sql.
//   Each RPC mutates the row and writes a state_history_deltas record in the
//   same transaction.
// =============================================================================

// ============================================================================
// Vendor Service
// ============================================================================

interface VendorServiceRow {
  id: string;
  audit_id: string;
  service_name: string;
  service_type: string;
  service_description: string | null;
  created_at: string;
  updated_at: string;
}

function flattenService(row: VendorServiceRow): MockVendorService {
  return {
    id: row.id,
    audit_id: row.audit_id,
    service_name: row.service_name,
    service_type: row.service_type,
    service_description: row.service_description,
  };
}

export async function fetchVendorService(auditId: string): Promise<MockVendorService | null> {
  const { data, error } = await supabase
    .from('vendor_service_objects')
    .select('*')
    .eq('audit_id', auditId)
    .maybeSingle();

  if (error) {
    console.error('[vendorEnrichmentApi] fetchVendorService error:', error);
    return null;
  }

  return data ? flattenService(data as VendorServiceRow) : null;
}

export async function createVendorService(
  auditId: string,
  service: Omit<MockVendorService, 'id' | 'audit_id'>
): Promise<MockVendorService | null> {
  const { data, error } = await supabase.rpc('audit_mode_create_vendor_service', {
    p_audit_id: auditId,
    p_service_name: service.service_name,
    p_service_type: service.service_type,
    p_service_description: service.service_description,
  });

  if (error) {
    console.error('[vendorEnrichmentApi] createVendorService error:', error);
    return null;
  }

  return flattenService(data as VendorServiceRow);
}

export async function updateVendorService(
  serviceId: string,
  updates: Partial<Omit<MockVendorService, 'id' | 'audit_id'>>,
  reason?: string
): Promise<MockVendorService | null> {
  const { data, error } = await supabase.rpc('audit_mode_update_vendor_service', {
    p_id: serviceId,
    p_service_name: updates.service_name ?? null,
    p_service_type: updates.service_type ?? null,
    p_service_description: updates.service_description ?? null,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[vendorEnrichmentApi] updateVendorService error:', error);
    return null;
  }

  return flattenService(data as VendorServiceRow);
}

export async function deleteVendorService(
  serviceId: string,
  reason?: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('audit_mode_delete_vendor_service', {
    p_id: serviceId,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[vendorEnrichmentApi] deleteVendorService error:', error);
    return false;
  }

  return Boolean(data);
}

// ============================================================================
// Service Mappings
// ============================================================================

interface ServiceMappingRow {
  id: string;
  vendor_service_id: string;
  protocol_risk_id: string;
  derived_criticality: DerivedCriticality;
  criticality_rationale: string | null;
  created_at: string;
  updated_at: string;
}

function flattenMapping(row: ServiceMappingRow): MockServiceMapping {
  return {
    id: row.id,
    vendor_service_id: row.vendor_service_id,
    protocol_risk_id: row.protocol_risk_id,
    derived_criticality: row.derived_criticality,
    criticality_rationale: row.criticality_rationale,
  };
}

export async function fetchServiceMappings(
  vendorServiceId: string
): Promise<MockServiceMapping[]> {
  const { data, error } = await supabase
    .from('vendor_service_mapping_objects')
    .select('*')
    .eq('vendor_service_id', vendorServiceId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[vendorEnrichmentApi] fetchServiceMappings error:', error);
    return [];
  }

  return ((data ?? []) as ServiceMappingRow[]).map(flattenMapping);
}

// Convenience for the load effect: get mappings via the audit's vendor_service.
// Empty array if the audit has no vendor service yet.
export async function fetchServiceMappingsByAudit(
  auditId: string
): Promise<MockServiceMapping[]> {
  const { data, error } = await supabase
    .from('vendor_service_mapping_objects')
    .select('*, vendor_service_objects!inner(audit_id)')
    .eq('vendor_service_objects.audit_id', auditId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[vendorEnrichmentApi] fetchServiceMappingsByAudit error:', error);
    return [];
  }

  return ((data ?? []) as ServiceMappingRow[]).map(flattenMapping);
}

export async function createServiceMapping(
  vendorServiceId: string,
  protocolRiskId: string,
  rationaleOverride?: string | null
): Promise<MockServiceMapping | null> {
  const { data, error } = await supabase.rpc('audit_mode_create_service_mapping', {
    p_vendor_service_id: vendorServiceId,
    p_protocol_risk_id: protocolRiskId,
    p_rationale_override: rationaleOverride ?? null,
  });

  if (error) {
    console.error('[vendorEnrichmentApi] createServiceMapping error:', error);
    return null;
  }

  return flattenMapping(data as ServiceMappingRow);
}

export async function updateServiceMapping(
  mappingId: string,
  updates: { derived_criticality?: DerivedCriticality; criticality_rationale?: string | null },
  reason?: string
): Promise<MockServiceMapping | null> {
  const { data, error } = await supabase.rpc('audit_mode_update_service_mapping', {
    p_id: mappingId,
    p_derived_criticality: updates.derived_criticality ?? null,
    p_criticality_rationale: updates.criticality_rationale ?? null,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[vendorEnrichmentApi] updateServiceMapping error:', error);
    return null;
  }

  return flattenMapping(data as ServiceMappingRow);
}

export async function deleteServiceMapping(
  mappingId: string,
  reason?: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('audit_mode_delete_service_mapping', {
    p_id: mappingId,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[vendorEnrichmentApi] deleteServiceMapping error:', error);
    return false;
  }

  return Boolean(data);
}

// ============================================================================
// Trust Assessment (1:1 with audit, upsert semantics)
// ============================================================================

interface TrustAssessmentRow {
  id: string;
  audit_id: string;
  certifications_claimed: string[];
  regulatory_claims: string[];
  compliance_posture: CompliancePosture;
  maturity_posture: MaturityPosture;
  provisional_trust_posture: TrustPosture;
  risk_hypotheses: string[];
  notes: string | null;
  assessed_by: string;
  assessed_at: string | null;
  created_at: string;
  updated_at: string;
}

function flattenTrust(row: TrustAssessmentRow): MockTrustAssessment {
  return {
    id: row.id,
    audit_id: row.audit_id,
    certifications_claimed: row.certifications_claimed,
    regulatory_claims: row.regulatory_claims,
    compliance_posture: row.compliance_posture,
    maturity_posture: row.maturity_posture,
    provisional_trust_posture: row.provisional_trust_posture,
    risk_hypotheses: row.risk_hypotheses,
    notes: row.notes,
  };
}

export async function fetchTrustAssessment(auditId: string): Promise<MockTrustAssessment | null> {
  const { data, error } = await supabase
    .from('trust_assessment_objects')
    .select('*')
    .eq('audit_id', auditId)
    .maybeSingle();

  if (error) {
    console.error('[vendorEnrichmentApi] fetchTrustAssessment error:', error);
    return null;
  }

  return data ? flattenTrust(data as TrustAssessmentRow) : null;
}

export async function upsertTrustAssessment(
  auditId: string,
  assessment: Partial<Omit<MockTrustAssessment, 'id' | 'audit_id'>>,
  reason?: string
): Promise<MockTrustAssessment | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_trust_assessment', {
    p_audit_id: auditId,
    p_certifications_claimed: assessment.certifications_claimed ?? null,
    p_regulatory_claims: assessment.regulatory_claims ?? null,
    p_compliance_posture: assessment.compliance_posture ?? null,
    p_maturity_posture: assessment.maturity_posture ?? null,
    p_provisional_trust_posture: assessment.provisional_trust_posture ?? null,
    p_risk_hypotheses: assessment.risk_hypotheses ?? null,
    p_notes: assessment.notes ?? null,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[vendorEnrichmentApi] upsertTrustAssessment error:', error);
    return null;
  }

  return flattenTrust(data as TrustAssessmentRow);
}

// Back-compat alias — older callers used updateTrustAssessment with an id.
// The RPC keys on audit_id (1:1), so id is only used to look up the audit_id.
export async function updateTrustAssessment(
  assessmentId: string,
  updates: Partial<Omit<MockTrustAssessment, 'id' | 'audit_id'>>,
  reason?: string
): Promise<MockTrustAssessment | null> {
  const { data: existing, error: fetchErr } = await supabase
    .from('trust_assessment_objects')
    .select('audit_id')
    .eq('id', assessmentId)
    .maybeSingle();

  if (fetchErr || !existing) {
    console.error('[vendorEnrichmentApi] updateTrustAssessment: lookup failed', fetchErr);
    return null;
  }

  return upsertTrustAssessment(existing.audit_id as string, updates, reason);
}
