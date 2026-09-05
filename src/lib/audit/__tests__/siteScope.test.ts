// siteScope — the Scope builder's derivation. Pins the contract the saved
// document relies on: grouping by module, the rollup (highest criticality
// per module), the ordering (modules by rollup then vocabulary order; items
// by criticality, section identifier, mapping id), the provenance every item
// carries (the mapping id), built_from, determinism, and drift by mapping
// set.

import { describe, it, expect } from 'vitest';
import type { TaggedSection } from '../mockProtocolRisks';
import type { SiteModuleMapping } from '../../../types/audit';
import { buildSiteScopeContent, scopeDrift } from '../siteScope';

function risk(patch: Partial<TaggedSection> & Pick<TaggedSection, 'id'>): TaggedSection {
  return {
    section_identifier: '§5.1',
    section_title: 'Primary endpoint: overall survival',
    endpoint_tier: 'PRIMARY',
    impact_surface: 'DATA_INTEGRITY',
    time_sensitivity: false,
    vendor_dependency_flags: [],
    operational_domain_tag: null,
    tagging_mode: 'MANUAL',
    version_change_type: 'ADDED',
    source_extracted_item_id: null,
    ...patch,
  };
}

function mapping(patch: Partial<SiteModuleMapping> & Pick<SiteModuleMapping, 'id'>): SiteModuleMapping {
  return {
    audit_id: 'audit-isa-1',
    protocol_risk_id: 'risk-1',
    isa_domain: 'INFORMED_CONSENT',
    derived_criticality: 'CRITICAL',
    criticality_rationale: 'Derived from: primary endpoint, data integrity impact.',
    created_at: '2026-09-05T00:00:00Z',
    updated_at: '2026-09-05T00:00:00Z',
    ...patch,
  };
}

const RISK_1 = risk({ id: 'risk-1' });
const RISK_2 = risk({
  id: 'risk-2',
  section_identifier: '§4.2',
  section_title: 'Eligibility: age',
  endpoint_tier: 'SAFETY',
  impact_surface: 'BOTH',
});
const RISK_3 = risk({
  id: 'risk-3',
  section_identifier: '§9.3',
  section_title: 'Data management plan',
  endpoint_tier: 'SUPPORTIVE',
  impact_surface: 'DATA_INTEGRITY',
});

const NOW = '2026-09-05T10:00:00.000Z';

describe('buildSiteScopeContent', () => {
  it('groups mappings by module, rolls criticality up to the highest item, and carries the mapping id on every item', () => {
    const content = buildSiteScopeContent(
      [
        mapping({ id: 'smm-1' }),
        mapping({ id: 'smm-2', isa_domain: 'SOURCE_DATA_VERIFICATION' }),
        mapping({
          id: 'smm-3',
          protocol_risk_id: 'risk-2',
          derived_criticality: 'HIGH',
          criticality_rationale: 'Derived from: safety endpoint, both impact.',
        }),
      ],
      [RISK_1, RISK_2],
      NOW,
    );

    expect(content.modules.map((m) => m.isa_domain)).toEqual([
      'INFORMED_CONSENT',
      'SOURCE_DATA_VERIFICATION',
    ]);
    const consent = content.modules[0];
    expect(consent.criticality).toBe('CRITICAL');
    expect(consent.items).toEqual([
      {
        id: 'smm-1',
        protocol_risk_id: 'risk-1',
        isa_domain: 'INFORMED_CONSENT',
        section_identifier: '§5.1',
        section_title: 'Primary endpoint: overall survival',
        criticality: 'CRITICAL',
        rationale: 'Derived from: primary endpoint, data integrity impact.',
      },
      {
        id: 'smm-3',
        protocol_risk_id: 'risk-2',
        isa_domain: 'INFORMED_CONSENT',
        section_identifier: '§4.2',
        section_title: 'Eligibility: age',
        criticality: 'HIGH',
        rationale: 'Derived from: safety endpoint, both impact.',
      },
    ]);
    expect(content.modules[1].items.map((i) => i.id)).toEqual(['smm-2']);
  });

  it('orders modules by rollup criticality first, then by the module vocabulary order', () => {
    const content = buildSiteScopeContent(
      [
        // Vocabulary order would put INFORMED_CONSENT first; its only item is
        // LOW, so it sorts last.
        mapping({ id: 'smm-a', protocol_risk_id: 'risk-3', derived_criticality: 'LOW' }),
        mapping({ id: 'smm-b', isa_domain: 'SOP_REVIEW', protocol_risk_id: 'risk-2', derived_criticality: 'HIGH' }),
        mapping({ id: 'smm-c', isa_domain: 'IRB_EC', protocol_risk_id: 'risk-2', derived_criticality: 'HIGH' }),
        mapping({ id: 'smm-d', isa_domain: 'ELECTRONIC_SYSTEMS', derived_criticality: 'CRITICAL' }),
      ],
      [RISK_1, RISK_2, RISK_3],
      NOW,
    );

    expect(content.modules.map((m) => [m.isa_domain, m.criticality])).toEqual([
      ['ELECTRONIC_SYSTEMS', 'CRITICAL'],
      ['IRB_EC', 'HIGH'],
      ['SOP_REVIEW', 'HIGH'],
      ['INFORMED_CONSENT', 'LOW'],
    ]);
  });

  it('orders items within a module by criticality, then section identifier, then mapping id', () => {
    const content = buildSiteScopeContent(
      [
        mapping({ id: 'smm-z', protocol_risk_id: 'risk-3', derived_criticality: 'MODERATE' }),
        mapping({ id: 'smm-y', protocol_risk_id: 'risk-2', derived_criticality: 'HIGH' }),
        mapping({ id: 'smm-x', protocol_risk_id: 'risk-1', derived_criticality: 'HIGH' }),
      ],
      [RISK_1, RISK_2, RISK_3],
      NOW,
    );

    expect(content.modules).toHaveLength(1);
    expect(content.modules[0].criticality).toBe('HIGH');
    // HIGH before MODERATE; among the HIGH items §4.2 sorts before §5.1.
    expect(content.modules[0].items.map((i) => i.id)).toEqual(['smm-y', 'smm-x', 'smm-z']);
  });

  it('records the mapping set it was built from (sorted) and the build time', () => {
    const content = buildSiteScopeContent(
      [mapping({ id: 'smm-9' }), mapping({ id: 'smm-1', isa_domain: 'IRB_EC' })],
      [RISK_1],
      NOW,
    );

    expect(content.built_from).toEqual({ mapping_ids: ['smm-1', 'smm-9'], built_at: NOW });
  });

  it('no mappings → an empty scope that still names when it was built', () => {
    expect(buildSiteScopeContent([], [RISK_1], NOW)).toEqual({
      built_from: { mapping_ids: [], built_at: NOW },
      modules: [],
    });
  });

  it('is deterministic: the same inputs in a different order give the same document', () => {
    const mappings = [
      mapping({ id: 'smm-1' }),
      mapping({ id: 'smm-2', isa_domain: 'SOURCE_DATA_VERIFICATION' }),
      mapping({ id: 'smm-3', protocol_risk_id: 'risk-2', derived_criticality: 'HIGH' }),
    ];
    const a = buildSiteScopeContent(mappings, [RISK_1, RISK_2], NOW);
    const b = buildSiteScopeContent([...mappings].reverse(), [RISK_2, RISK_1], NOW);
    expect(b).toEqual(a);
  });
});

describe('scopeDrift', () => {
  const content = buildSiteScopeContent(
    [mapping({ id: 'smm-1' }), mapping({ id: 'smm-2', isa_domain: 'IRB_EC' })],
    [RISK_1],
    NOW,
  );

  it('no drift while the live set matches the one the scope was built from', () => {
    expect(scopeDrift(content, [mapping({ id: 'smm-2', isa_domain: 'IRB_EC' }), mapping({ id: 'smm-1' })])).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it('counts mappings added since the build', () => {
    expect(
      scopeDrift(content, [mapping({ id: 'smm-1' }), mapping({ id: 'smm-2' }), mapping({ id: 'smm-3' })]),
    ).toEqual({ added: 1, removed: 0 });
  });

  it('counts mappings removed since the build', () => {
    expect(scopeDrift(content, [mapping({ id: 'smm-1' })])).toEqual({ added: 0, removed: 1 });
  });

  it('counts both directions at once', () => {
    expect(scopeDrift(content, [mapping({ id: 'smm-7' })])).toEqual({ added: 1, removed: 2 });
  });
});
