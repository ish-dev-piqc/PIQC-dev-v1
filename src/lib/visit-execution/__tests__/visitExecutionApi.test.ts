import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOCK_TOGGLE_KEY,
  fetchVisitExecutionWorkspaces,
  isMockEnabled,
} from '../visitExecutionApi';
import { supabase } from '../../supabase';
import { DEMO_PROTOCOL_IDS } from '../../demo/ids';

// =============================================================================
// visitExecutionApi — Result<T> contract + localStorage mock-toggle behaviour.
//
// Two paths to verify:
//   1. Mock on  → returns rich fixture data from mockVisitWorkspace.ts;
//                 does NOT call supabase.rpc.
//   2. Mock off → calls supabase.rpc('visit_execution_get_workspace', {...}).
//                 Surfaces RPC errors as ok:false. Treats null/missing
//                 workspaces as empty array (RLS empty-result contract).
//
// Sprint 3.5b change: real path no longer goes through the Sprint 1 bridge
// (fetchVisitTemplates + adapter). Tests updated accordingly.
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

  it('returns the BRIGHTEN-2 mock workspaces without calling supabase.rpc', async () => {
    const spy = vi.spyOn(supabase, 'rpc');
    const result = await fetchVisitExecutionWorkspaces(DEMO_PROTOCOL_IDS['BRIGHTEN-2']);
    expect(spy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].snapshot.visit_name).toBeTruthy();
    }
  });

  it('mock fixture surfaces Sprint 3.5a fields: snapshot.confidence_state + signal_count + per-item confidence_state', async () => {
    const result = await fetchVisitExecutionWorkspaces(DEMO_PROTOCOL_IDS['BRIGHTEN-2']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Every workspace's snapshot has a confidence_state (high|medium|low|needs_review).
    for (const ws of result.data) {
      expect(ws.snapshot.confidence_state).toMatch(/^(high|medium|low|needs_review)$/);
      expect(Array.isArray(ws.snapshot.completeness_signals)).toBe(true);
      // Count rollup must equal array length — the RPC computes it independently
      // in production, but the contract is that they always agree.
      expect(ws.snapshot.completeness_signal_count).toBe(
        ws.snapshot.completeness_signals.length,
      );
      for (const item of ws.items) {
        // Curated fixture items default confidence_state to a string (not null).
        expect(item.confidence_state).toMatch(/^(high|medium|low|needs_review)$/);
      }
    }

    // At least one visit has a non-empty completeness_signals array
    // (Week 6 visit seeds one — exercising the new VisitCompletenessSignal shape).
    const weekSix = result.data.find((w) => w.snapshot.visit_name === 'Week 6 visit');
    expect(weekSix).toBeDefined();
    if (weekSix) {
      expect(weekSix.snapshot.completeness_signal_count).toBeGreaterThan(0);
      expect(weekSix.snapshot.completeness_signals.length).toBeGreaterThan(0);
      const signal = weekSix.snapshot.completeness_signals[0];
      expect(signal.gap_text).toBeTruthy();
      expect(signal.detection_confidence).toMatch(/^(high|medium|low|needs_review)$/);
      // detected_at is a real ISO string, not the hard-coded 2026-05-26 placeholder.
      expect(Date.parse(signal.detected_at)).not.toBeNaN();
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

describe('fetchVisitExecutionWorkspaces — mock off (Sprint 3.5b RPC path)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('calls supabase.rpc("visit_execution_get_workspace", { p_protocol_id })', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // Cast to any: PostgrestSingleResponse type is messy to mock fully.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { workspaces: [] },
      error: null,
    } as any);

    await fetchVisitExecutionWorkspaces('proto-z');
    expect(spy).toHaveBeenCalledWith('visit_execution_get_workspace', {
      p_protocol_id: 'proto-z',
    });
  });

  it('returns the workspaces array unwrapped from the RPC payload', async () => {
    const fakePayload = {
      workspaces: [
        {
          visit_template_id: 'tpl-1',
          protocol_id: 'proto-z',
          snapshot: { visit_name: 'Screening' },
          items: [],
        },
      ],
    };
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: fakePayload, error: null,
    } as any);

    const result = await fetchVisitExecutionWorkspaces('proto-z');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].visit_template_id).toBe('tpl-1');
    }
  });

  it('surfaces RPC errors as ok:false (no throw)', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: { message: 'simulated supabase failure' } as any,
    } as any);

    const result = await fetchVisitExecutionWorkspaces('proto-z');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('simulated supabase failure');
    }
  });

  it('returns ok:true with [] when RPC returns null payload (ownership-gate empty)', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: null, error: null,
    } as any);
    const result = await fetchVisitExecutionWorkspaces('proto-z');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });

  it('returns ok:true with [] when RPC returns payload without a workspaces array', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // Server-side schema drift fallback — treat as empty rather than crash.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { workspaces: null } as any, error: null,
    } as any);
    const result = await fetchVisitExecutionWorkspaces('proto-z');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });
});
