import { describe, expect, it } from 'vitest';
import {
  adaptAccessRequest,
  adaptAccessRequests,
} from '../accessRequestsAdapter';

// =============================================================================
// accessRequestsAdapter — pure mapper smoke tests.
// =============================================================================

const validRow = {
  id: 'r-1',
  protocol_id: 'p-1',
  user_id: 'u-1',
  status: 'pending',
  message: 'I need access for monitoring',
  requested_at: '2026-01-01T00:00:00Z',
  resolved_at: null,
  resolved_by: null,
};

describe('adaptAccessRequest', () => {
  it('maps a valid pending request', () => {
    const r = adaptAccessRequest(validRow);
    expect(r.id).toBe('r-1');
    expect(r.status).toBe('pending');
    expect(r.message).toBe('I need access for monitoring');
    expect(r.resolved_at).toBeNull();
  });

  it('accepts all four valid status values', () => {
    for (const status of ['pending', 'approved', 'denied', 'withdrawn'] as const) {
      expect(adaptAccessRequest({ ...validRow, status }).status).toBe(status);
    }
  });

  it('throws on an unknown status', () => {
    expect(() => adaptAccessRequest({ ...validRow, status: 'closed' })).toThrow(
      /Invalid protocol_access_request status/,
    );
  });

  it('preserves null message + resolution fields', () => {
    const r = adaptAccessRequest({
      ...validRow,
      message: null,
      resolved_at: null,
      resolved_by: null,
    });
    expect(r.message).toBeNull();
    expect(r.resolved_at).toBeNull();
    expect(r.resolved_by).toBeNull();
  });

  it('maps resolved fields when present', () => {
    const r = adaptAccessRequest({
      ...validRow,
      status: 'approved',
      resolved_at: '2026-01-02T00:00:00Z',
      resolved_by: 'u-coord',
    });
    expect(r.resolved_at).toBe('2026-01-02T00:00:00Z');
    expect(r.resolved_by).toBe('u-coord');
  });
});

describe('adaptAccessRequests', () => {
  it('maps each row in an array', () => {
    const mapped = adaptAccessRequests([
      validRow,
      { ...validRow, id: 'r-2', status: 'approved' },
    ]);
    expect(mapped).toHaveLength(2);
    expect(mapped[1].status).toBe('approved');
  });

  it('returns an empty array for an empty input', () => {
    expect(adaptAccessRequests([])).toEqual([]);
  });
});
