import { describe, expect, it } from 'vitest';
import {
  adaptChatReaction,
  adaptChatReactions,
  groupReactionsByMessage,
  type ChatReactionRow,
} from '../chatReactionsAdapter';

const orgRow = (over: Partial<ChatReactionRow> = {}): ChatReactionRow => ({
  id: over.id ?? 'r-1',
  org_message_id: 'm-1',
  protocol_message_id: null,
  org_id: 'org-1',
  protocol_id: null,
  user_id: over.user_id ?? 'u-1',
  emoji: over.emoji ?? '👍',
  created_at: '2026-06-04T00:00:00Z',
  ...over,
});

describe('adaptChatReaction', () => {
  it('passes every column through', () => {
    const r = adaptChatReaction(orgRow({ id: 'r-7', emoji: '✅' }));
    expect(r.id).toBe('r-7');
    expect(r.emoji).toBe('✅');
    expect(r.org_message_id).toBe('m-1');
    expect(r.protocol_message_id).toBeNull();
  });
});

describe('adaptChatReactions', () => {
  it('maps over an array', () => {
    const out = adaptChatReactions([orgRow({ id: 'a' }), orgRow({ id: 'b' })]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('groupReactionsByMessage', () => {
  it('groups by message + emoji and counts', () => {
    const rows = adaptChatReactions([
      orgRow({ id: 'r1', user_id: 'u-1', emoji: '👍' }),
      orgRow({ id: 'r2', user_id: 'u-2', emoji: '👍' }),
      orgRow({ id: 'r3', user_id: 'u-3', emoji: '❤️' }),
    ]);
    const map = groupReactionsByMessage(rows, 'u-1');
    const chips = map.get('m-1')!;
    expect(chips).toHaveLength(2);
    const thumbs = chips.find((c) => c.emoji === '👍')!;
    expect(thumbs.count).toBe(2);
    expect(thumbs.selfReacted).toBe(true);
    expect(thumbs.userIds).toEqual(['u-1', 'u-2']);
    const heart = chips.find((c) => c.emoji === '❤️')!;
    expect(heart.count).toBe(1);
    expect(heart.selfReacted).toBe(false);
  });

  it('keys by protocol_message_id when the row is on the protocol side', () => {
    const rows = adaptChatReactions([
      orgRow({
        id: 'r1',
        org_message_id: null,
        protocol_message_id: 'm-99',
        org_id: null,
        protocol_id: 'p-1',
      }),
    ]);
    const map = groupReactionsByMessage(rows, null);
    expect(map.has('m-99')).toBe(true);
    expect(map.get('m-99')?.[0].count).toBe(1);
  });

  it('returns an empty map for an empty input', () => {
    expect(groupReactionsByMessage([], 'u-1').size).toBe(0);
  });

  it('handles null currentUserId — no chip is self-reacted', () => {
    const rows = adaptChatReactions([orgRow({ user_id: 'u-1' })]);
    const chips = groupReactionsByMessage(rows, null).get('m-1')!;
    expect(chips[0].selfReacted).toBe(false);
  });
});
