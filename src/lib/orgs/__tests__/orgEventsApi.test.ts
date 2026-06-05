import { beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// orgEventsApi — smoke tests for the listOrgEvents wrapper. Behaviour of
// the actual SELECT (RLS, ordering, pagination) is covered by the
// migration's verification block + manual test plan in
// plans/kiara/org-activity-log.md. Tests here lock in the public surface
// and the Result<T> contract so a future refactor can't accidentally
// throw instead of returning { ok: false }.
// =============================================================================

const limitMock = vi.fn();
const orderMock = vi.fn();
const ltMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();

// Each chained call returns the same builder so we can re-use the
// same vi.fn for assertions. The terminal call (`limit`) is awaited
// in the API, so it returns a promise of { data, error }.
function setBuilderResolution(value: { data: unknown[] | null; error: unknown }) {
  limitMock.mockResolvedValue(value);
}

vi.mock('../../supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => {
      fromMock(...args);
      return {
        select: (...a: unknown[]) => {
          selectMock(...a);
          return {
            eq: (...a2: unknown[]) => {
              eqMock(...a2);
              return {
                order: (...a3: unknown[]) => {
                  orderMock(...a3);
                  return {
                    limit: (...a4: unknown[]) => {
                      limitMock(...a4);
                      return limitMock.mock.results[limitMock.mock.results.length - 1].value;
                    },
                    lt: (...a4: unknown[]) => {
                      ltMock(...a4);
                      return {
                        limit: (...a5: unknown[]) => {
                          limitMock(...a5);
                          return limitMock.mock.results[limitMock.mock.results.length - 1].value;
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  },
}));

describe('orgEventsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports listOrgEvents', async () => {
    const m = await import('../orgEventsApi');
    expect(typeof m.listOrgEvents).toBe('function');
  });

  it('returns { ok: true, data: [] } on empty result', async () => {
    setBuilderResolution({ data: [], error: null });
    const { listOrgEvents } = await import('../orgEventsApi');
    const res = await listOrgEvents('org-1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([]);
    expect(fromMock).toHaveBeenCalledWith('org_events');
    expect(eqMock).toHaveBeenCalledWith('org_id', 'org-1');
    expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(limitMock).toHaveBeenCalledWith(50);
  });

  it('maps row payload through the adapter', async () => {
    setBuilderResolution({
      data: [
        {
          id: 'ev-1',
          org_id: 'org-1',
          event_type: 'org_member_added',
          actor_user_id: 'u-1',
          target_user_id: 'u-2',
          target_protocol_id: null,
          payload: { role: 'member' },
          created_at: '2026-06-04T12:00:00Z',
        },
      ],
      error: null,
    });
    const { listOrgEvents } = await import('../orgEventsApi');
    const res = await listOrgEvents('org-1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0].event_type).toBe('org_member_added');
      expect(res.data[0].payload).toEqual({ role: 'member' });
    }
  });

  it('honours the limit param', async () => {
    setBuilderResolution({ data: [], error: null });
    const { listOrgEvents } = await import('../orgEventsApi');
    await listOrgEvents('org-1', { limit: 10 });
    expect(limitMock).toHaveBeenCalledWith(10);
  });

  it('applies the `before` cursor via .lt()', async () => {
    setBuilderResolution({ data: [], error: null });
    const { listOrgEvents } = await import('../orgEventsApi');
    await listOrgEvents('org-1', { before: '2026-06-04T00:00:00Z' });
    expect(ltMock).toHaveBeenCalledWith('created_at', '2026-06-04T00:00:00Z');
  });

  it('surfaces a Supabase error as { ok: false }', async () => {
    setBuilderResolution({ data: null, error: { message: 'permission denied' } });
    const { listOrgEvents } = await import('../orgEventsApi');
    const res = await listOrgEvents('org-1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('permission denied');
  });
});
