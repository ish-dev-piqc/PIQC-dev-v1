import { describe, expect, it } from 'vitest';
import { CRA_ARTIFACT_ORDER } from '../craDeliverables';
import { DELIVERABLE_CONFIGS } from '../../../deliverables/deliverableConfigs';
import {
  ARTIFACT_TYPE_LABELS,
  type DeliverableArtifactType,
} from '../../../../types/deliverables';

// =============================================================================
// craDeliverables — the CRA workspace's role lens IS this subset. These tests
// pin the PR-B decision: the monitor sees exactly the two operational
// deliverables, focus first, and every one of them can actually mount in the
// shared panel. If someone later adds risk/SIV here (re-forking the sponsor
// tab) or drops focus from first, these fail.
// =============================================================================

const ALL_ARTIFACT_TYPES = Object.keys(ARTIFACT_TYPE_LABELS) as DeliverableArtifactType[];

describe('CRA_ARTIFACT_ORDER', () => {
  it('leads with monitoring focus (the workspace default)', () => {
    expect(CRA_ARTIFACT_ORDER[0]).toBe('cra_monitoring_focus');
  });

  it('is exactly the monitor operational pair — focus + checklist', () => {
    expect([...CRA_ARTIFACT_ORDER]).toEqual([
      'cra_monitoring_focus',
      'monitoring_prep_checklist',
    ]);
  });

  it('excludes the sponsor-facing deliverables (risk overview, SIV)', () => {
    expect(CRA_ARTIFACT_ORDER).not.toContain('risk_overview');
    expect(CRA_ARTIFACT_ORDER).not.toContain('siv_package');
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
