// =============================================================================
// Mock ProtocolRiskObject data for Phase B INTAKE.
//
// Keyed by audit_id. In the real schema risks belong to ProtocolVersion (not
// Audit), and multiple audits sharing a version see the same risks. For mock
// purposes we key by audit because each mock audit binds to a unique protocol.
//
// Sponsor-name-free by rule.
// =============================================================================

import type {
  EndpointTier,
  ImpactSurface,
  TaggingMode,
  VersionChangeType,
} from '../../types/audit';

// Display-shape used by the INTAKE workspace. This intentionally drops a few
// fields the UI doesn't surface (suggestion_provenance, lineage pointers,
// timestamps for creation vs update) — those rejoin the type when we wire
// real Supabase reads.
export interface TaggedSection {
  id: string;
  section_identifier: string;        // e.g. "5.3.2", "§7.1", etc.
  section_title: string;
  endpoint_tier: EndpointTier;
  impact_surface: ImpactSurface;
  time_sensitivity: boolean;
  vendor_dependency_flags: string[]; // controlled vocab values
  operational_domain_tag: string;    // controlled vocab value
  tagging_mode: TaggingMode;
  version_change_type: VersionChangeType;
}

export const MOCK_PROTOCOL_RISKS: Record<string, TaggedSection[]> = {
  // BRIGHTEN-2 — Phase 3 oncology, full-service CRO. Mature tagging; eight
  // sections covering primary endpoint, safety, and operational dependencies.
  'audit-001': [
    {
      id: 'pr-001-01',
      section_identifier: '7.1',
      section_title: 'Primary endpoint analysis (overall survival)',
      endpoint_tier: 'PRIMARY',
      impact_surface: 'DATA_INTEGRITY',
      time_sensitivity: false,
      vendor_dependency_flags: ['cro_full_service', 'biostats'],
      operational_domain_tag: 'biostats',
      tagging_mode: 'MANUAL',
      version_change_type: 'ADDED',
    },
    {
      id: 'pr-001-02',
      section_identifier: '5.4',
      section_title: 'Randomization procedures',
      endpoint_tier: 'SECONDARY',
      impact_surface: 'DATA_INTEGRITY',
      time_sensitivity: true,
      vendor_dependency_flags: ['IVRS'],
      operational_domain_tag: 'IVRS',
      tagging_mode: 'MANUAL',
      version_change_type: 'ADDED',
    },
    {
      id: 'pr-001-03',
      section_identifier: '6.2',
      section_title: 'Data management plan',
      endpoint_tier: 'SECONDARY',
      impact_surface: 'DATA_INTEGRITY',
      time_sensitivity: false,
      vendor_dependency_flags: ['EDC', 'cro_full_service'],
      operational_domain_tag: 'EDC',
      tagging_mode: 'MANUAL',
      version_change_type: 'ADDED',
    },
    {
      id: 'pr-001-04',
      section_identifier: '8.1',
      section_title: 'Adverse event reporting',
      endpoint_tier: 'SAFETY',
      impact_surface: 'PATIENT_SAFETY',
      time_sensitivity: true,
      vendor_dependency_flags: ['pharmacovigilance', 'cro_full_service'],
      operational_domain_tag: 'pharmacovigilance',
      tagging_mode: 'MANUAL',
      version_change_type: 'ADDED',
    },
    {
      id: 'pr-001-05',
      section_identifier: '6.5',
      section_title: 'Trial master file management',
      endpoint_tier: 'SUPPORTIVE',
      impact_surface: 'DATA_INTEGRITY',
      time_sensitivity: false,
      vendor_dependency_flags: ['eTMF'],
      operational_domain_tag: 'eTMF',
      tagging_mode: 'MANUAL',
      version_change_type: 'ADDED',
    },
  ],

  // CARDIAC-7 — Phase 2/3 heart failure, central lab. INTAKE stage — partial
  // tagging in progress. Two sections done.
  'audit-002': [
    {
      id: 'pr-002-01',
      section_identifier: '7.1',
      section_title: 'Primary endpoint (NT-proBNP at week 12)',
      endpoint_tier: 'PRIMARY',
      impact_surface: 'DATA_INTEGRITY',
      time_sensitivity: true,
      vendor_dependency_flags: ['central_lab'],
      operational_domain_tag: 'central_lab',
      tagging_mode: 'MANUAL',
      version_change_type: 'ADDED',
    },
    {
      id: 'pr-002-02',
      section_identifier: '5.6',
      section_title: 'ECG safety monitoring',
      endpoint_tier: 'SAFETY',
      impact_surface: 'PATIENT_SAFETY',
      time_sensitivity: true,
      vendor_dependency_flags: ['ECG'],
      operational_domain_tag: 'ECG',
      tagging_mode: 'MANUAL',
      version_change_type: 'ADDED',
    },
  ],

  // IMMUNE-14 — Phase 2 autoimmune, ePRO platform. Mature tagging.
  'audit-003': [
    {
      id: 'pr-003-01',
      section_identifier: '6.1',
      section_title: 'PRO assessment schedule',
      endpoint_tier: 'PRIMARY',
      impact_surface: 'DATA_INTEGRITY',
      time_sensitivity: true,
      vendor_dependency_flags: ['ePRO'],
      operational_domain_tag: 'ePRO',
      tagging_mode: 'MANUAL',
      version_change_type: 'ADDED',
    },
    {
      id: 'pr-003-02',
      section_identifier: '7.2',
      section_title: 'Disease activity score derivation',
      endpoint_tier: 'PRIMARY',
      impact_surface: 'DATA_INTEGRITY',
      time_sensitivity: false,
      vendor_dependency_flags: ['ePRO'],
      operational_domain_tag: 'ePRO',
      tagging_mode: 'MANUAL',
      version_change_type: 'ADDED',
    },
    {
      id: 'pr-003-03',
      section_identifier: '8.4',
      section_title: 'Patient device hygiene SOPs',
      endpoint_tier: 'SUPPORTIVE',
      impact_surface: 'BOTH',
      time_sensitivity: false,
      vendor_dependency_flags: ['ePRO'],
      operational_domain_tag: 'ePRO',
      tagging_mode: 'MANUAL',
      version_change_type: 'ADDED',
    },
  ],
};
