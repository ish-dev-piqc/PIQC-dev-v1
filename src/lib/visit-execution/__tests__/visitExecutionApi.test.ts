import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOCK_TOGGLE_KEY,
  fetchHumanEditLog,
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
    // (the Cycle 4 + CIPN visit seeds one — exercising the VisitCompletenessSignal shape).
    const seeded = result.data.find(
      (w) => w.snapshot.visit_name === 'Cycle 4 Day 1 + CIPN assessment',
    );
    expect(seeded).toBeDefined();
    if (seeded) {
      expect(seeded.snapshot.completeness_signal_count).toBeGreaterThan(0);
      expect(seeded.snapshot.completeness_signals.length).toBeGreaterThan(0);
      const signal = seeded.snapshot.completeness_signals[0];
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


// =============================================================================
// fetchHumanEditLog — Sprint 4c. Wraps visit_execution_get_human_edit_log.
// =============================================================================

describe('fetchHumanEditLog — mock on', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(MOCK_TOGGLE_KEY, '1');
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns a synthetic event list without calling supabase.rpc', async () => {
    const spy = vi.spyOn(supabase, 'rpc');
    const r = await fetchHumanEditLog('req-1');
    expect(spy).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.length).toBeGreaterThan(0);
      expect(r.data[0].action).toBeTruthy();
      expect(Date.parse(r.data[0].created_at)).not.toBeNaN();
    }
  });
});

describe('fetchHumanEditLog — mock off RPC dispatch', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('calls visit_execution_get_human_edit_log with p_requirement_id', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { events: [] }, error: null,
    } as any);
    await fetchHumanEditLog('req-7');
    expect(spy).toHaveBeenCalledWith('visit_execution_get_human_edit_log', {
      p_requirement_id: 'req-7',
    });
  });

  it('narrows events array to typed VisitRequirementHumanEditEvent shape', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        events: [
          {
            id: 'evt-1',
            action: 'edit_text',
            reviewer_id: 'u-1',
            previous_text: 'old',
            new_text: 'new',
            reviewer_note: null,
            requirement_version: 2,
            amendment_version: null,
            created_at: '2026-05-27T10:00:00Z',
          },
        ],
      }, error: null,
    } as any);

    const r = await fetchHumanEditLog('req-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0].action).toBe('edit_text');
      expect(r.data[0].previous_text).toBe('old');
      expect(r.data[0].new_text).toBe('new');
    }
  });

  it('drops malformed event rows without crashing', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        events: [
          // Valid
          {
            id: 'evt-1', action: 'mark_reviewed', reviewer_id: 'u-1',
            previous_text: null, new_text: null, reviewer_note: null,
            requirement_version: 1, amendment_version: null,
            created_at: '2026-05-27T09:00:00Z',
          },
          // Missing required fields — should be dropped
          { id: 'evt-bad', action: 'mark_reviewed' },
          null,
          { some: 'garbage' },
        ],
      }, error: null,
    } as any);

    const r = await fetchHumanEditLog('req-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0].id).toBe('evt-1');
    }
  });

  it('returns empty array when RPC returns null payload', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: null, error: null,
    } as any);
    const r = await fetchHumanEditLog('req-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual([]);
  });

  it('surfaces RPC errors as ok:false', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: { message: 'not authenticated' } as any,
    } as any);
    const r = await fetchHumanEditLog('req-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not authenticated');
  });

  it('returns empty array when events field is absent (server schema drift fallback)', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { other: 'shape' } as any, error: null,
    } as any);
    const r = await fetchHumanEditLog('req-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual([]);
  });
});
