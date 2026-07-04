import { describe, it, expect } from 'vitest';
import {
  adaptProtocolMessage,
  adaptProtocolMessages,
  type ProtocolMessageRow,
} from '../protocolMessagesAdapter';

describe('protocolMessagesAdapter', () => {
  it('maps all fields straight through', () => {
    const row: ProtocolMessageRow = {
      id: 'msg-1',
      protocol_id: 'proto-1',
      author_user_id: 'user-1',
      body: 'hello team',
      created_at: '2026-06-03T12:00:00.000Z',
      edited_at: '2026-06-03T12:05:00.000Z',
      deleted_at: null,
      parent_message_id: 'msg-0',
    };
    expect(adaptProtocolMessage(row)).toEqual(row);
  });

  it('defaults edited_at / deleted_at / parent_message_id to null on legacy rows', () => {
    const legacy: ProtocolMessageRow = {
      id: 'msg-1',
      protocol_id: 'proto-1',
      author_user_id: 'user-1',
      body: 'hello team',
      created_at: '2026-06-03T12:00:00.000Z',
    };
    expect(adaptProtocolMessage(legacy)).toEqual({
      ...legacy,
      edited_at: null,
      deleted_at: null,
      parent_message_id: null,
    });
  });

  it('preserves null author_user_id (deleted user)', () => {
    const row: ProtocolMessageRow = {
      id: 'msg-1',
      protocol_id: 'proto-1',
      author_user_id: null,
      body: 'orphaned message',
      created_at: '2026-06-03T12:00:00.000Z',
    };
    expect(adaptProtocolMessage(row).author_user_id).toBeNull();
  });

  it('handles an empty array', () => {
    expect(adaptProtocolMessages([])).toEqual([]);
  });

  it('maps a multi-row array preserving order', () => {
    const rows: ProtocolMessageRow[] = [
      {
        id: '1',
        protocol_id: 'p',
        author_user_id: 'u',
        body: 'first',
        created_at: '2026-06-03T12:00:00Z',
      },
      {
        id: '2',
        protocol_id: 'p',
        author_user_id: 'u',
        body: 'second',
        created_at: '2026-06-03T12:01:00Z',
      },
    ];
    const result = adaptProtocolMessages(rows);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
  });
});
