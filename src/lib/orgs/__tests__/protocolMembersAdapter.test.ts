import { describe, expect, it } from 'vitest';
import {
  adaptProtocolMember,
  adaptProtocolMembers,
} from '../protocolMembersAdapter';

// =============================================================================
// protocolMembersAdapter — pure mapper smoke tests.
// Asserts: valid rows pass through with shape preserved; invalid role throws
// (defensive guard against DB drift).
// =============================================================================

const validRow = {
  protocol_id: 'p-1',
  user_id: 'u-1',
  role: 'coordinator',
  added_at: '2026-01-01T00:00:00Z',
  added_by: 'u-2',
};

describe('adaptProtocolMember', () => {
  it('maps a valid row to a typed ProtocolMember', () => {
    const m = adaptProtocolMember(validRow);
    expect(m.protocol_id).toBe('p-1');
    expect(m.user_id).toBe('u-1');
    expect(m.role).toBe('coordinator');
    expect(m.added_by).toBe('u-2');
  });

  it('accepts all three valid roles', () => {
    for (const role of ['coordinator', 'member', 'viewer'] as const) {
      expect(adaptProtocolMember({ ...validRow, role }).role).toBe(role);
    }
  });

  it('throws on an unknown role (DB-drift guard)', () => {
    expect(() => adaptProtocolMember({ ...validRow, role: 'owner' })).toThrow(
      /Invalid protocol_member role/,
    );
  });

  it('handles null added_by', () => {
    expect(adaptProtocolMember({ ...validRow, added_by: null }).added_by).toBeNull();
  });
});

describe('adaptProtocolMembers', () => {
  it('maps each row in an array', () => {
    const rows = [validRow, { ...validRow, user_id: 'u-3', role: 'viewer' }];
    const mapped = adaptProtocolMembers(rows);
    expect(mapped).toHaveLength(2);
    expect(mapped[1].role).toBe('viewer');
  });

  it('returns an empty array for an empty input', () => {
    expect(adaptProtocolMembers([])).toEqual([]);
  });
});
