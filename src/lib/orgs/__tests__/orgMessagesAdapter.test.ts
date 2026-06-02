import { describe, it, expect } from 'vitest';
import {
  adaptOrgMessage,
  adaptOrgMessages,
  type OrgMessageRow,
} from '../orgMessagesAdapter';

describe('orgMessagesAdapter', () => {
  it('maps all fields straight through', () => {
    const row: OrgMessageRow = {
      id: 'msg-1',
      org_id: 'org-1',
      author_user_id: 'user-1',
      body: 'hello team',
      created_at: '2026-06-01T12:00:00.000Z',
    };
    expect(adaptOrgMessage(row)).toEqual(row);
  });

  it('preserves null author_user_id (deleted user case)', () => {
    const row: OrgMessageRow = {
      id: 'msg-1',
      org_id: 'org-1',
      author_user_id: null,
      body: 'hello',
      created_at: '2026-06-01T12:00:00.000Z',
    };
    expect(adaptOrgMessage(row).author_user_id).toBeNull();
  });

  it('handles an empty array', () => {
    expect(adaptOrgMessages([])).toEqual([]);
  });

  it('maps a multi-row array preserving order', () => {
    const rows: OrgMessageRow[] = [
      {
        id: '1',
        org_id: 'o',
        author_user_id: 'u',
        body: 'first',
        created_at: '2026-06-01T12:00:00Z',
      },
      {
        id: '2',
        org_id: 'o',
        author_user_id: 'u',
        body: 'second',
        created_at: '2026-06-01T12:01:00Z',
      },
    ];
    const result = adaptOrgMessages(rows);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
  });
});
