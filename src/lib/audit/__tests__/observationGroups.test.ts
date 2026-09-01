import { describe, expect, it } from 'vitest';
import type { MockWorkspaceEntry } from '../mockWorkspaceEntries';
import type {
  ProvisionalClassification,
  ProvisionalImpact,
} from '../../../types/audit';
import {
  REPORT_CLASSIFICATION_ORDER,
  buildObservationGroups,
} from '../observationGroups';

// =============================================================================
// buildObservationGroups — the one grouping every report surface renders
// (Stage 7 screen, Stage 8 markdown + docx). Pins the contract the three
// former copies had already started drifting on: section order, per-group
// numbering, NOT_YET_CLASSIFIED exclusion, and label derivation.
// =============================================================================

function entry(
  id: string,
  classification: ProvisionalClassification,
  overrides: Partial<MockWorkspaceEntry> = {},
): MockWorkspaceEntry {
  return {
    id,
    audit_id: 'audit-1',
    protocol_risk_id: null,
    vendor_service_mapping_id: null,
    questionnaire_response_id: null,
    checkpoint_ref: null,
    vendor_domain: 'Validation',
    observation_text: `Observation body for ${id}`,
    provisional_impact: 'MINOR' as ProvisionalImpact,
    provisional_classification: classification,
    inherited_endpoint_tier: null,
    inherited_impact_surface: null,
    inherited_time_sensitivity: null,
    risk_context_outdated: false,
    source_extracted_item_id: null,
    created_by_name: 'Auditor One',
    created_at: '2026-08-01T09:00:00Z',
    ...overrides,
  };
}

describe('buildObservationGroups', () => {
  it('returns the three report groups in pinned order, even for no entries', () => {
    const groups = buildObservationGroups([]);
    expect(groups.map((g) => g.key)).toEqual([...REPORT_CLASSIFICATION_ORDER]);
    expect(groups.map((g) => g.key)).toEqual([
      'FINDING',
      'OBSERVATION',
      'OPPORTUNITY_FOR_IMPROVEMENT',
    ]);
    expect(groups.every((g) => g.items.length === 0)).toBe(true);
  });

  it('groups by classification, preserves entry order, and numbers per group from 1', () => {
    const groups = buildObservationGroups([
      entry('e1', 'OBSERVATION'),
      entry('e2', 'FINDING'),
      entry('e3', 'OBSERVATION'),
      entry('e4', 'FINDING'),
      entry('e5', 'OPPORTUNITY_FOR_IMPROVEMENT'),
    ]);
    const [findings, observations, ofis] = groups;

    expect(findings.items.map((b) => b.entry.id)).toEqual(['e2', 'e4']);
    expect(findings.items.map((b) => b.number)).toEqual([1, 2]);
    expect(observations.items.map((b) => b.entry.id)).toEqual(['e1', 'e3']);
    // Numbering restarts per group — the exports print it as "1. …".
    expect(observations.items.map((b) => b.number)).toEqual([1, 2]);
    expect(ofis.items.map((b) => b.entry.id)).toEqual(['e5']);
    expect(ofis.items.map((b) => b.number)).toEqual([1]);
  });

  it('excludes NOT_YET_CLASSIFIED entries from every group', () => {
    const groups = buildObservationGroups([
      entry('e1', 'NOT_YET_CLASSIFIED'),
      entry('e2', 'FINDING'),
    ]);
    expect(groups.flatMap((g) => g.items.map((b) => b.entry.id))).toEqual(['e2']);
  });

  it('derives labels and passes fields through — the block is render-ready', () => {
    const [findings] = buildObservationGroups([
      entry('e1', 'FINDING', {
        vendor_domain: 'Device hygiene',
        observation_text: 'Calibration log gap on line 3.',
        provisional_impact: 'CRITICAL',
        checkpoint_ref: 'SOP-14 §2.1',
      }),
    ]);
    expect(findings.items[0]).toMatchObject({
      number: 1,
      vendorDomain: 'Device hygiene',
      impactLabel: 'Critical',
      classificationLabel: 'Finding',
      observationText: 'Calibration log gap on line 3.',
      checkpointRef: 'SOP-14 §2.1',
    });
  });

  it('hands back the source entry by identity for surface-specific extras', () => {
    const source = entry('e1', 'OBSERVATION', { protocol_risk_id: 'risk-9' });
    const [, observations] = buildObservationGroups([source]);
    // Stage 7 reads protocol_risk_id off the entry for its linked-risk line.
    expect(observations.items[0].entry).toBe(source);
  });
});
