import { describe, expect, it } from 'vitest';
import { CRA_ARTIFACT_ORDER } from '../craDeliverables';
import { DELIVERABLE_CONFIGS } from '../../../deliverables/deliverableConfigs';
import {
  ARTIFACT_TYPE_LABELS,
  type DeliverableArtifactType,
} from '../../../../types/deliverables';

// =============================================================================
// craDeliverables — merged 2026-08-02: the workspace shows all five
// deliverable types (the former CRA-only two-item subset was folded into
// Sponsor's five-item picker order when the two modes merged into one
// Protocol Intelligence workspace). These tests pin: checklist leads, every
// type is real and mountable, and no duplicates.
// =============================================================================

const ALL_ARTIFACT_TYPES = Object.keys(ARTIFACT_TYPE_LABELS) as DeliverableArtifactType[];

describe('CRA_ARTIFACT_ORDER', () => {
  it('leads with the monitoring prep checklist (the workspace default)', () => {
    expect(CRA_ARTIFACT_ORDER[0]).toBe('monitoring_prep_checklist');
  });

  it('includes every deliverable type — nothing lost in the merge', () => {
    expect([...CRA_ARTIFACT_ORDER].sort()).toEqual([...ALL_ARTIFACT_TYPES].sort());
  });

  it('lists only real artifact types, with no duplicates', () => {
    for (const type of CRA_ARTIFACT_ORDER) {
      expect(ALL_ARTIFACT_TYPES, `${type} is not a real artifact type`).toContain(type);
    }
    expect(new Set(CRA_ARTIFACT_ORDER).size).toBe(CRA_ARTIFACT_ORDER.length);
  });

  it('only lists deliverables the shared panel can mount', () => {
    for (const type of CRA_ARTIFACT_ORDER) {
      expect(DELIVERABLE_CONFIGS[type], `no panel config for ${type}`).toBeDefined();
    }
  });
});
