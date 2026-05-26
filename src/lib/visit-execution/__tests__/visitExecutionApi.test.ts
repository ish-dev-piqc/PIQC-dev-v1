import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOCK_TOGGLE_KEY,
  fetchVisitExecutionWorkspaces,
  isMockEnabled,
} from '../visitExecutionApi';
import * as siteApi from '../../site/siteApi';
import { DEMO_PROTOCOL_IDS } from '../../demo/ids';
import type { ProtocolVisitTemplate } from '../../site/types';

// =============================================================================
// visitExecutionApi — Result<T> contract + localStorage mock-toggle behaviour.
//
// Two paths to verify:
//   1. Mock on  → returns rich fixture data from mockVisitWorkspace.ts;
//                 does NOT call fetchVisitTemplates.
//   2. Mock off → calls fetchVisitTemplates and runs the result through
//                 visitExecutionAdapter. Surfaces fetch errors as ok:false.
// =============================================================================

describe('isMockEnabled', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns false by default (toggle absent)', () => {
    expect(isMockEnabled()).toBe(false);
  });

  it("returns true only for the literal value '1'", () => {
    window.localStorage.setItem(MOCK_TOGGLE_KEY, '1');
    expect(isMockEnabled()).toBe(true);
  });

  it("returns false for truthy-looking but non-'1' values", () => {
    for (const value of ['true', 'yes', 'on', '0', '']) {
      window.localStorage.setItem(MOCK_TOGGLE_KEY, value);
      expect(isMockEnabled()).toBe(false);
    }
  });

  it('uses the documented key', () => {
    // Sprint 1 contract — other code (e.g. dev tools, future migrations
    // off the mock) depends on this exact string.
    expect(MOCK_TOGGLE_KEY).toBe('piq-visit-execution-mock-v1');
  });
});

describe('fetchVisitExecutionWorkspaces — mock on', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(MOCK_TOGGLE_KEY, '1');
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns the BRIGHTEN-2 mock workspaces without calling fetchVisitTemplates', async () => {
    const spy = vi.spyOn(siteApi, 'fetchVisitTemplates');
    const result = await fetchVisitExecutionWorkspaces(DEMO_PROTOCOL_IDS['BRIGHTEN-2']);
    expect(spy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].snapshot.visit_name).toBeTruthy();
    }
  });

  it('returns an empty array for a protocol with no mock fixture', async () => {
    const result = await fetchVisitExecutionWorkspaces('not-a-demo-protocol');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });
});

describe('fetchVisitExecutionWorkspaces — mock off', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('delegates to fetchVisitTemplates and runs results through the adapter', async () => {
    const templates: ProtocolVisitTemplate[] = [
      {
        id: 'tpl-1',
        protocol_id: 'proto-z',
        visit_name: 'Screening',
        study_day: -7,
        window_minus_days: 0,
        window_plus_days: 3,
        procedures: ['Informed consent', 'Vitals'],
        source_document_id: null,
        cross_references: [],
      },
    ];
    vi.spyOn(siteApi, 'fetchVisitTemplates').mockResolvedValue({ ok: true, data: templates });

    const result = await fetchVisitExecutionWorkspaces('proto-z');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].visit_template_id).toBe('tpl-1');
      expect(result.data[0].items.map((i) => i.label)).toEqual([
        'Informed consent',
        'Vitals',
      ]);
    }
  });

  it('passes fetchVisitTemplates errors through as ok:false (no throw)', async () => {
    vi.spyOn(siteApi, 'fetchVisitTemplates').mockResolvedValue({
      ok: false,
      error: 'simulated supabase failure',
    });

    const result = await fetchVisitExecutionWorkspaces('proto-z');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('simulated supabase failure');
    }
  });

  it('returns ok:true with [] when fetchVisitTemplates returns no rows', async () => {
    vi.spyOn(siteApi, 'fetchVisitTemplates').mockResolvedValue({ ok: true, data: [] });
    const result = await fetchVisitExecutionWorkspaces('proto-z');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });
});
