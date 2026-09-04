// =============================================================================
// TaggedSection — display shape for ProtocolRiskObject rows (INTAKE stage).
//
// In the real schema risks belong to ProtocolVersion (not Audit), and multiple
// audits sharing a version see the same risks.
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
  /** Vendor-axis controlled vocab value. null on risks tagged from an
   *  investigator site audit — they carry no vendor domain (20260915000000). */
  operational_domain_tag: string | null;
  tagging_mode: TaggingMode;
  version_change_type: VersionChangeType;
  /** Optional FK to the SOTR protocol_extracted_item this risk traces back to.
   *  NULL = manually tagged without a parsed-source link (legacy or unlinked). */
  source_extracted_item_id: string | null;
}
