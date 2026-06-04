import { describe, it, expect } from 'vitest';
import {
  adaptChatMention,
  adaptChatMentions,
  type ChatMentionRow,
} from '../chatMentionsAdapter';

describe('chatMentionsAdapter', () => {
  it('maps all fields straight through for an org-message mention', () => {
    const row: ChatMentionRow = {
      id: 'm-1',
      org_message_id: 'msg-1',
      protocol_message_id: null,
      org_id: 'org-1',
      protocol_id: null,
      mentioned_user_id: 'user-1',
      mentioned_by_user_id: 'user-2',
      created_at: '2026-06-04T12:00:00.000Z',
      read_at: null,
    };
    expect(adaptChatMention(row)).toEqual(row);
  });

  it('maps all fields straight through for a protocol-message mention', () => {
    const row: ChatMentionRow = {
      id: 'm-2',
      org_message_id: null,
      protocol_message_id: 'pmsg-1',
      org_id: null,
      protocol_id: 'proto-1',
      mentioned_user_id: 'user-1',
      mentioned_by_user_id: 'user-2',
      created_at: '2026-06-04T12:00:00.000Z',
      read_at: '2026-06-04T12:05:00.000Z',
    };
    expect(adaptChatMention(row)).toEqual(row);
  });

  it('preserves null mentioned_by_user_id (author deleted)', () => {
    const row: ChatMentionRow = {
      id: 'm-3',
      org_message_id: 'msg-1',
      protocol_message_id: null,
      org_id: 'org-1',
      protocol_id: null,
      mentioned_user_id: 'user-1',
      mentioned_by_user_id: null,
      created_at: '2026-06-04T12:00:00.000Z',
      read_at: null,
    };
    expect(adaptChatMention(row).mentioned_by_user_id).toBeNull();
  });

  it('handles an empty array', () => {
    expect(adaptChatMentions([])).toEqual([]);
  });

  it('maps multiple rows', () => {
    const rows: ChatMentionRow[] = [
      {
        id: '1',
        org_message_id: 'a',
        protocol_message_id: null,
        org_id: 'o',
        protocol_id: null,
        mentioned_user_id: 'u',
        mentioned_by_user_id: null,
        created_at: '2026-06-04T12:00:00Z',
        read_at: null,
      },
      {
        id: '2',
        org_message_id: null,
        protocol_message_id: 'p',
        org_id: null,
        protocol_id: 'proto-1',
        mentioned_user_id: 'u',
        mentioned_by_user_id: 'a',
        created_at: '2026-06-04T12:01:00Z',
        read_at: null,
      },
    ];
    expect(adaptChatMentions(rows)).toHaveLength(2);
  });
});
