import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOCK_TOGGLE_KEY,
  fetchHumanEditLog,
  fetchProtocolCohorts,
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

describe('fetchVisitExecutionWorkspaces — demo alias → real protocol remap', () => {
  // Demo Visit-Prep content is NOT bundled. The 3 demo "alias" protocol ids
  // resolve to the real protocol id and are fetched at runtime via the
  // RLS-protected RPC; results are re-labeled to the alias for the UI. (RLS on
  // the RPC is what actually gates who gets data — owner/org only.)
  const REAL_IDS: Record<string, string> = {
    [DEMO_PROTOCOL_IDS['BRIGHTEN-2']]: 'b04e989a-7df7-48e2-bef7-d551d685876a',
    [DEMO_PROTOCOL_IDS['CARDIAC-7']]: '4bf903e9-b98a-46ab-9027-135ac2cac590',
    [DEMO_PROTOCOL_IDS['IMMUNE-14']]: 'cad4ea2e-f63e-4a71-b609-8fba1858b30a',
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the RPC with the REAL protocol id and re-labels workspaces to the alias', async () => {
    for (const [alias, realId] of Object.entries(REAL_IDS)) {
      const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: {
          workspaces: [
            { visit_template_id: 'vt-1', protocol_id: realId, snapshot: { visit_name: 'V1' }, items: [] },
          ],
        },
        error: null,
      } as any);

      const result = await fetchVisitExecutionWorkspaces(alias);
      expect(spy).toHaveBeenCalledWith('visit_execution_get_workspace', { p_protocol_id: realId });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // content fetched at runtime (never bundled) and re-labeled to the alias
        expect(result.data[0].protocol_id).toBe(alias);
      }
      spy.mockRestore();
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


// =============================================================================
// fetchProtocolCohorts — Slice 3. Reads protocol_cohorts directly under RLS:
// supabase.from('protocol_cohorts').select(...).eq(protocol_id).order(ordinal).
// Demo alias ids resolve to the real protocol id (same as the workspace RPC).
// =============================================================================
describe('fetchProtocolCohorts — Slice 3 (direct RLS read of protocol_cohorts)', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  // Mock the from().select().eq().order() chain; order() resolves the query.
  function mockCohortQuery(resolved: { data: unknown; error: unknown }) {
    const order = vi.fn().mockResolvedValue(resolved);
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const from = vi.spyOn(supabase, 'from').mockReturnValue({ select } as any);
    return { from, select, eq, order };
  }

  it('reads protocol_cohorts under RLS and maps rows to ProtocolCohort (order preserved)', async () => {
    mockCohortQuery({
      data: [
        { label: 'S1', dose_regimen: '10 mg', description: 'low', ordinal: 0, source_page: 12 },
        { label: 'S2', dose_regimen: null, description: null, ordinal: 1, source_page: null },
      ],
      error: null,
    });
    const r = await fetchProtocolCohorts('proto-z');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(2);
      expect(r.data[0]).toEqual({ label: 'S1', dose_regimen: '10 mg', description: 'low', ordinal: 0, source_page: 12 });
      expect(r.data[1].dose_regimen).toBeNull();
    }
  });

  it('resolves a demo alias id to the real protocol id in the query', async () => {
    const { eq } = mockCohortQuery({ data: [], error: null });
    await fetchProtocolCohorts(DEMO_PROTOCOL_IDS['BRIGHTEN-2']);
    expect(eq).toHaveBeenCalledWith('protocol_id', 'b04e989a-7df7-48e2-bef7-d551d685876a');
  });

  it('drops rows without a usable label (schema-drift safety)', async () => {
    mockCohortQuery({
      data: [{ label: 'S1', ordinal: 0 }, { label: '', ordinal: 1 }, { ordinal: 2 }],
      error: null,
    });
    const r = await fetchProtocolCohorts('proto-z');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.map((c) => c.label)).toEqual(['S1']);
  });

  it('surfaces a query error as ok:false (no throw)', async () => {
    mockCohortQuery({ data: null, error: { message: 'rls denied' } });
    const r = await fetchProtocolCohorts('proto-z');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('rls denied');
  });

  it('returns [] in mock mode without touching supabase', async () => {
    window.localStorage.setItem(MOCK_TOGGLE_KEY, '1');
    const spy = vi.spyOn(supabase, 'from');
    const r = await fetchProtocolCohorts('proto-z');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
