import { describe, expect, it } from 'vitest';
import { DELIVERABLE_CONFIGS } from '../deliverableConfigs';
import {
  ARTIFACT_TYPE_LABELS,
  type DeliverableArtifactType,
} from '../../../types/deliverables';

// =============================================================================
// deliverableConfigs — the shared per-artifact section config consumed by both
// the Sponsor Protocol Intelligence tab and the CRA Monitoring Workspace.
// These invariants are what let either surface mount <DeliverablePanel/> for
// any artifact type without a per-surface config drifting out of sync.
//
// ARTIFACT_TYPE_LABELS is the canonical enumerator (the whitelist-from-labels
// lesson): iterating it, not a hand-listed set, is what catches a new artifact
// type that forgot its config.
// =============================================================================

const ALL_ARTIFACT_TYPES = Object.keys(ARTIFACT_TYPE_LABELS) as DeliverableArtifactType[];

describe('DELIVERABLE_CONFIGS', () => {
  it('has a config entry for every artifact type', () => {
    for (const type of ALL_ARTIFACT_TYPES) {
      expect(DELIVERABLE_CONFIGS[type], `missing config for ${type}`).toBeDefined();
    }
    // Symmetry: no orphan config for a type that no longer exists.
    expect(Object.keys(DELIVERABLE_CONFIGS).sort()).toEqual([...ALL_ARTIFACT_TYPES].sort());
  });

  it('gives every type a non-empty section order', () => {
    for (const type of ALL_ARTIFACT_TYPES) {
      expect(DELIVERABLE_CONFIGS[type].sectionOrder.length, type).toBeGreaterThan(0);
    }
  });

  it('labels every section it orders (no unlabeled section keys)', () => {
    for (const type of ALL_ARTIFACT_TYPES) {
      const { sectionOrder, sectionLabels } = DELIVERABLE_CONFIGS[type];
      for (const key of sectionOrder) {
        expect(sectionLabels[key], `${type} → ${key} has no label`).toBeTruthy();
      }
    }
  });

  it('enables export only for the document deliverables (checklist, SIV)', () => {
    expect(DELIVERABLE_CONFIGS.monitoring_prep_checklist.exportEnabled).toBe(true);
    expect(DELIVERABLE_CONFIGS.siv_package.exportEnabled).toBe(true);
    // Read surfaces, not documents handed onward.
    expect(DELIVERABLE_CONFIGS.risk_overview.exportEnabled).toBe(false);
    expect(DELIVERABLE_CONFIGS.cra_monitoring_focus.exportEnabled).toBe(false);
  });
});
