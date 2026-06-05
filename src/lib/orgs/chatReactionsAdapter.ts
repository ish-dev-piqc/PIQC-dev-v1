import type { ChatReaction } from '../../types/orgs';

// =============================================================================
// chatReactionsAdapter — pure mapper from raw chat_reactions row to
// the typed ChatReaction interface. No Supabase / network import.
// =============================================================================

export interface ChatReactionRow {
  id: string;
  org_message_id: string | null;
  protocol_message_id: string | null;
  org_id: string | null;
  protocol_id: string | null;
  user_id: string;
  emoji: string;
  created_at: string;
}

export function adaptChatReaction(row: ChatReactionRow): ChatReaction {
  return {
    id: row.id,
    org_message_id: row.org_message_id,
    protocol_message_id: row.protocol_message_id,
    org_id: row.org_id,
    protocol_id: row.protocol_id,
    user_id: row.user_id,
    emoji: row.emoji,
    created_at: row.created_at,
  };
}

export function adaptChatReactions(rows: ChatReactionRow[]): ChatReaction[] {
  return rows.map(adaptChatReaction);
}

// ---------------------------------------------------------------------------
// Group helper — collapse a flat ChatReaction list into per-message,
// per-emoji counts + own-reacted flag. Pure utility used by the UI to
// render reaction chips without re-counting on every render.
// ---------------------------------------------------------------------------

export interface ReactionChip {
  emoji: string;
  count: number;
  selfReacted: boolean;
  /** All user_ids who used this emoji, in insertion order. Useful for
   *  tooltips ("Kiara, Karl reacted with 👍"). */
  userIds: string[];
}

/** Returns a Map keyed by message id (either org_message_id or
 *  protocol_message_id depending on the row's xor side) to an ordered
 *  list of unique-emoji chips. */
export function groupReactionsByMessage(
  reactions: ChatReaction[],
  currentUserId: string | null,
): Map<string, ReactionChip[]> {
  const out = new Map<string, ReactionChip[]>();
  for (const r of reactions) {
    const messageId = r.org_message_id ?? r.protocol_message_id;
    if (!messageId) continue;
    let list = out.get(messageId);
    if (!list) {
      list = [];
      out.set(messageId, list);
    }
    let chip = list.find((c) => c.emoji === r.emoji);
    if (!chip) {
      chip = { emoji: r.emoji, count: 0, selfReacted: false, userIds: [] };
      list.push(chip);
    }
    chip.count += 1;
    chip.userIds.push(r.user_id);
    if (r.user_id === currentUserId) chip.selfReacted = true;
  }
  return out;
}
