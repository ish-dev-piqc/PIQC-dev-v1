import { describe, expect, it } from 'vitest';
import {
  adaptGuest,
  adaptGuests,
  countActiveFreeGuests,
} from '../guestsAdapter';

// =============================================================================
// guestsAdapter — pure mapper + countActiveFreeGuests smoke tests.
// =============================================================================

const now = '2026-06-01T00:00:00Z';
const future = '2099-12-31T00:00:00Z';
const past = '2020-01-01T00:00:00Z';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g-1',
    protocol_id: 'p-1',
    invited_email: 'guest@example.com',
    invited_by: 'u-coord',
    user_id: null,
    invite_token: 'tok-abc',
    accepted_at: null,
    expires_at: future,
    is_paid_seat: false,
    created_at: now,
    ...overrides,
  };
}

describe('adaptGuest', () => {
  it('maps a pending invite (not yet accepted)', () => {
    const g = adaptGuest(row());
    expect(g.invited_email).toBe('guest@example.com');
    expect(g.accepted_at).toBeNull();
    expect(g.user_id).toBeNull();
    expect(g.is_paid_seat).toBe(false);
  });

  it('maps an accepted invite', () => {
    const g = adaptGuest(
      row({ user_id: 'u-guest', accepted_at: now, is_paid_seat: true }),
    );
    expect(g.user_id).toBe('u-guest');
    expect(g.accepted_at).toBe(now);
    expect(g.is_paid_seat).toBe(true);
  });
});

describe('adaptGuests', () => {
  it('maps each row in an array', () => {
    const mapped = adaptGuests([row(), row({ id: 'g-2' })]);
    expect(mapped).toHaveLength(2);
  });
});

describe('countActiveFreeGuests', () => {
  it('counts accepted, non-expired, non-paid guests only', () => {
    const rows = [
      row({ id: '1', user_id: 'u-a', accepted_at: now }),                              // counts
      row({ id: '2', user_id: 'u-b', accepted_at: now, is_paid_seat: true }),          // paid, excluded
      row({ id: '3', user_id: 'u-c', accepted_at: null }),                             // unaccepted, excluded
      row({ id: '4', user_id: 'u-d', accepted_at: now, expires_at: past }),            // expired, excluded
      row({ id: '5', user_id: 'u-e', accepted_at: now, expires_at: future }),          // counts
    ];
    expect(countActiveFreeGuests(rows)).toBe(2);
  });

  it('returns 0 for an empty list', () => {
    expect(countActiveFreeGuests([])).toBe(0);
  });
});
