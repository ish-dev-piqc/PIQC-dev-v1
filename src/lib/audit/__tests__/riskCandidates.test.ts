// Unit tests for the deterministic risk-candidate rules.
//
// The rule table in riskCandidates.ts is the whole clinical assumption of the
// feature, so every row is pinned here: which item shape yields which tier /
// surface / time-sensitivity / title, what is skipped rather than guessed,
// how accepted items are deduped, and the order the auditor sees. The
// provenance record is checked to carry identifiers and the proposal only.

import { describe, it, expect } from 'vitest';
import {
  candidateProvenance,
  deriveRiskCandidates,
  VENDOR_CANDIDATE_RULES,
  type CandidateSourceItem,
} from '../riskCandidates';
import type { TaggedSection } from '../mockProtocolRisks';
import type { RiskCandidateRule } from '../../../types/audit';

const AT = '2026-09-04T12:00:00.000Z';
const ALL_RULES: readonly RiskCandidateRule[] = [...VENDOR_CANDIDATE_RULES, 'criterion'];

function item(
  overrides: Partial<CandidateSourceItem> &
    Pick<CandidateSourceItem, 'id' | 'field_type' | 'field_path'>,
): CandidateSourceItem {
  return {
    document_id: 'doc-1',
    extracted_value: null,
    confidence_state: 'high',
    review_status: 'draft',
    current_text: null,
    section_number: null,
    page_number: null,
    ...overrides,
  };
}

function tagged(sourceId: string | null): TaggedSection {
  return {
    id: `risk-${sourceId ?? 'manual'}`,
    section_identifier: '4.1',
    section_title: 'Existing',
    endpoint_tier: 'PRIMARY',
    impact_surface: 'DATA_INTEGRITY',
    time_sensitivity: false,
    vendor_dependency_flags: [],
    operational_domain_tag: 'CENTRAL_LAB',
    tagging_mode: 'MANUAL',
    version_change_type: 'ADDED',
    source_extracted_item_id: sourceId,
  };
}

const visitValue = (patch: Record<string, unknown> = {}) => ({
  visit_name: 'Screening',
  study_day: -14,
  window_minus_days: 3,
  window_plus_days: 3,
  procedures: ['ECG', 'Labs'],
  ...patch,
});

describe('deriveRiskCandidates — rule table', () => {
  it('primary endpoint → PRIMARY / DATA_INTEGRITY, not time-sensitive, title from the value', () => {
    const { candidates, skipped } = deriveRiskCandidates(
      [item({ id: 'i1', field_type: 'endpoint', field_path: 'primary_endpoints[0]', extracted_value: 'Overall survival' })],
      [],
      ALL_RULES,
      AT,
    );
    expect(skipped).toBe(0);
    expect(candidates).toEqual([
      expect.objectContaining({
        source_extracted_item_id: 'i1',
        rule: 'endpoint_primary',
        endpoint_tier: 'PRIMARY',
        impact_surface: 'DATA_INTEGRITY',
        time_sensitivity: false,
        section_identifier: 'primary_endpoints[0]',
        section_title: 'Overall survival',
        derived_at: AT,
      }),
    ]);
  });

  it('secondary endpoint → SECONDARY / DATA_INTEGRITY', () => {
    const { candidates } = deriveRiskCandidates(
      [item({ id: 'i1', field_type: 'endpoint', field_path: 'secondary_endpoints[2]', extracted_value: 'ORR' })],
      [],
      ALL_RULES,
      AT,
    );
    expect(candidates[0]).toEqual(
      expect.objectContaining({ rule: 'endpoint_secondary', endpoint_tier: 'SECONDARY', impact_surface: 'DATA_INTEGRITY' }),
    );
  });

  it('dosing → SAFETY / PATIENT_SAFETY with a "Dosing regimen —" title', () => {
    const { candidates } = deriveRiskCandidates(
      [item({ id: 'i1', field_type: 'dosing', field_path: 'dosing_regimen', extracted_value: '10 mg twice daily' })],
      [],
      ALL_RULES,
      AT,
    );
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        rule: 'dosing',
        endpoint_tier: 'SAFETY',
        impact_surface: 'PATIENT_SAFETY',
        time_sensitivity: false,
        section_title: 'Dosing regimen — 10 mg twice daily',
      }),
    );
  });

  it('criterion → SAFETY / BOTH, only when the rule is included', () => {
    const items = [
      item({ id: 'i1', field_type: 'criterion', field_path: 'key_inclusion_criteria[0]', extracted_value: 'Age ≥ 18' }),
    ];
    const withCriteria = deriveRiskCandidates(items, [], ALL_RULES, AT);
    expect(withCriteria.candidates[0]).toEqual(
      expect.objectContaining({ rule: 'criterion', endpoint_tier: 'SAFETY', impact_surface: 'BOTH' }),
    );

    // Vendor Intake: excluded by policy, so neither proposed nor counted as skipped.
    const vendor = deriveRiskCandidates(items, [], VENDOR_CANDIDATE_RULES, AT);
    expect(vendor.candidates).toEqual([]);
    expect(vendor.skipped).toBe(0);
  });

  it('visit with procedures → SUPPORTIVE / DATA_INTEGRITY; a non-zero window makes it time-sensitive', () => {
    const { candidates } = deriveRiskCandidates(
      [item({ id: 'v1', field_type: 'visit', field_path: 'schedule_of_events[0]', extracted_value: visitValue() })],
      [],
      ALL_RULES,
      AT,
    );
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        rule: 'visit',
        endpoint_tier: 'SUPPORTIVE',
        impact_surface: 'DATA_INTEGRITY',
        time_sensitivity: true,
        section_title: 'Screening — Day -14 (±3d) · ECG, Labs',
      }),
    );
  });

  it('visit with a zero-width window is not time-sensitive', () => {
    const { candidates } = deriveRiskCandidates(
      [
        item({
          id: 'v1',
          field_type: 'visit',
          field_path: 'schedule_of_events[1]',
          extracted_value: visitValue({ visit_name: 'Randomization', study_day: 0, window_minus_days: 0, window_plus_days: 0, procedures: ['Consent'] }),
        }),
      ],
      [],
      ALL_RULES,
      AT,
    );
    expect(candidates[0].time_sensitivity).toBe(false);
    expect(candidates[0].section_title).toBe('Randomization — Day 0 (±0d) · Consent');
  });

  it('visit titles show asymmetric windows, at most four procedures, and omit a missing study day', () => {
    const { candidates } = deriveRiskCandidates(
      [
        item({
          id: 'v1',
          field_type: 'visit',
          field_path: 'schedule_of_events[2]',
          extracted_value: visitValue({
            visit_name: 'Week 4',
            study_day: 28,
            window_minus_days: 5,
            window_plus_days: 1,
            procedures: ['a', 'b', 'c', 'd', 'e', 'f'],
          }),
        }),
        item({
          id: 'v2',
          field_type: 'visit',
          field_path: 'schedule_of_events[3]',
          extracted_value: visitValue({ visit_name: 'Unscheduled', study_day: undefined, procedures: ['Vitals'] }),
        }),
      ],
      [],
      ALL_RULES,
      AT,
    );
    expect(candidates.map((c) => c.section_title)).toEqual([
      'Week 4 — Day 28 (-5/+1d) · a, b, c, d, +2 more',
      'Unscheduled · Vitals',
    ]);
  });
});

describe('deriveRiskCandidates — identifier and title', () => {
  it('prefers the primary evidence section over the field path, without doubling the §', () => {
    const { candidates } = deriveRiskCandidates(
      [
        item({ id: 'i1', field_type: 'endpoint', field_path: 'primary_endpoints[0]', extracted_value: 'OS', section_number: '5.1.2' }),
        item({ id: 'i2', field_type: 'endpoint', field_path: 'primary_endpoints[1]', extracted_value: 'PFS', section_number: '§5.1.3' }),
        item({ id: 'i3', field_type: 'endpoint', field_path: 'primary_endpoints[2]', extracted_value: 'DOR', section_number: '   ' }),
      ],
      [],
      ALL_RULES,
      AT,
    );
    expect(candidates.map((c) => c.section_identifier)).toEqual(['§5.1.2', '§5.1.3', 'primary_endpoints[2]']);
  });

  it("uses the reviewer's edited text over the extracted value, collapses whitespace, clips at 120", () => {
    const long = 'x'.repeat(200);
    const { candidates } = deriveRiskCandidates(
      [
        item({ id: 'i1', field_type: 'endpoint', field_path: 'primary_endpoints[0]', extracted_value: 'raw', current_text: '  edited\n  text ' }),
        item({ id: 'i2', field_type: 'endpoint', field_path: 'primary_endpoints[1]', extracted_value: long, current_text: '   ' }),
      ],
      [],
      ALL_RULES,
      AT,
    );
    expect(candidates[0].section_title).toBe('edited text');
    expect(candidates[1].section_title.length).toBeLessThanOrEqual(120);
    expect(candidates[1].section_title.endsWith('…')).toBe(true);
  });
});

describe('deriveRiskCandidates — skipped, dedupe, ignored', () => {
  it('counts unproposable shapes as skipped instead of guessing', () => {
    const { candidates, skipped } = deriveRiskCandidates(
      [
        // endpoint under a path that is neither primary nor secondary
        item({ id: 'a', field_type: 'endpoint', field_path: 'exploratory_endpoints[0]', extracted_value: 'x' }),
        // non-text endpoint value
        item({ id: 'b', field_type: 'endpoint', field_path: 'primary_endpoints[0]', extracted_value: { text: 'x' } }),
        // dosing that is not text
        item({ id: 'c', field_type: 'dosing', field_path: 'dosing_regimen', extracted_value: 42 }),
        // visit without procedures
        item({ id: 'd', field_type: 'visit', field_path: 'schedule_of_events[0]', extracted_value: visitValue({ procedures: [] }) }),
        // visit without a name
        item({ id: 'e', field_type: 'visit', field_path: 'schedule_of_events[1]', extracted_value: visitValue({ visit_name: '' }) }),
        // visit value that is not an object
        item({ id: 'f', field_type: 'visit', field_path: 'schedule_of_events[2]', extracted_value: 'Day 1' }),
      ],
      [],
      ALL_RULES,
      AT,
    );
    expect(candidates).toEqual([]);
    expect(skipped).toBe(6);
  });

  it('ignores non-candidate field types silently', () => {
    const { candidates, skipped } = deriveRiskCandidates(
      [item({ id: 'm', field_type: 'metadata', field_path: 'protocol_title', extracted_value: 'Title' })],
      [],
      ALL_RULES,
      AT,
    );
    expect(candidates).toEqual([]);
    expect(skipped).toBe(0);
  });

  it('drops items already linked from a tagged risk, and they are not counted as skipped', () => {
    const { candidates, skipped } = deriveRiskCandidates(
      [
        item({ id: 'i1', field_type: 'endpoint', field_path: 'primary_endpoints[0]', extracted_value: 'OS' }),
        item({ id: 'i2', field_type: 'endpoint', field_path: 'primary_endpoints[1]', extracted_value: 'PFS' }),
        // linked but malformed: dedupe wins, so it is neither proposed nor skipped
        item({ id: 'i3', field_type: 'endpoint', field_path: 'primary_endpoints[2]', extracted_value: 7 }),
      ],
      [tagged('i1'), tagged('i3'), tagged(null)],
      ALL_RULES,
      AT,
    );
    expect(candidates.map((c) => c.source_extracted_item_id)).toEqual(['i2']);
    expect(skipped).toBe(0);
  });
});

describe('deriveRiskCandidates — order', () => {
  it('primary → secondary → dosing → visits by study day (missing last) → criteria; endpoints by their [n] index', () => {
    const { candidates } = deriveRiskCandidates(
      [
        item({ id: 'crit', field_type: 'criterion', field_path: 'key_exclusion_criteria[0]', extracted_value: 'Pregnancy' }),
        item({ id: 'v-late', field_type: 'visit', field_path: 'schedule_of_events[0]', extracted_value: visitValue({ visit_name: 'Week 8', study_day: 56 }) }),
        item({ id: 'v-none', field_type: 'visit', field_path: 'schedule_of_events[1]', extracted_value: visitValue({ visit_name: 'Unscheduled', study_day: undefined }) }),
        item({ id: 'sec', field_type: 'endpoint', field_path: 'secondary_endpoints[0]', extracted_value: 'ORR' }),
        item({ id: 'p10', field_type: 'endpoint', field_path: 'primary_endpoints[10]', extracted_value: 'Tenth' }),
        item({ id: 'dose', field_type: 'dosing', field_path: 'dosing_regimen', extracted_value: '10 mg' }),
        item({ id: 'v-early', field_type: 'visit', field_path: 'schedule_of_events[2]', extracted_value: visitValue({ visit_name: 'Screening', study_day: -14 }) }),
        item({ id: 'p2', field_type: 'endpoint', field_path: 'primary_endpoints[2]', extracted_value: 'Second' }),
      ],
      [],
      ALL_RULES,
      AT,
    );
    expect(candidates.map((c) => c.source_extracted_item_id)).toEqual([
      'p2',
      'p10',
      'sec',
      'dose',
      'v-early',
      'v-late',
      'v-none',
      'crit',
    ]);
  });
});

describe('candidateProvenance', () => {
  it('records the rule, the item coordinates and the proposal — no protocol text beyond the proposed title', () => {
    const { candidates } = deriveRiskCandidates(
      [
        item({
          id: 'i1',
          field_type: 'endpoint',
          field_path: 'primary_endpoints[0]',
          extracted_value: 'Overall survival',
          confidence_state: 'medium',
          section_number: '5.1',
          page_number: 12,
          document_id: 'doc-9',
        }),
      ],
      [],
      ALL_RULES,
      AT,
    );
    expect(candidateProvenance(candidates[0])).toEqual({
      source: 'sotr_item',
      rule: 'endpoint_primary',
      field_path: 'primary_endpoints[0]',
      field_type: 'endpoint',
      confidence_state: 'medium',
      document_id: 'doc-9',
      proposed: {
        section_identifier: '§5.1',
        section_title: 'Overall survival',
        endpoint_tier: 'PRIMARY',
        impact_surface: 'DATA_INTEGRITY',
        time_sensitivity: false,
      },
      derived_at: AT,
    });
  });
});
