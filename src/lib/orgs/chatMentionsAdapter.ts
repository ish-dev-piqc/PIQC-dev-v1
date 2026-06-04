import type { ChatMention } from '../../types/orgs';

// =============================================================================
// chatMentionsAdapter — pure mapper from the raw `chat_mentions` row shape
// returned by Supabase to the typed ChatMention interface. No Supabase
// import here; this file is data-only.
// =============================================================================

export interface ChatMentionRow {
  id: string;
  org_message_id: string | null;
  protocol_message_id: string | null;
  org_id: string | null;
  protocol_id: string | null;
  mentioned_user_id: string;
  mentioned_by_user_id: string | null;
  created_at: string;
  read_at: string | null;
}

export function adaptChatMention(row: ChatMentionRow): ChatMention {
  return {
    id: row.id,
    org_message_id: row.org_message_id,
    protocol_message_id: row.protocol_message_id,
    org_id: row.org_id,
    protocol_id: row.protocol_id,
    mentioned_user_id: row.mentioned_user_id,
    mentioned_by_user_id: row.mentioned_by_user_id,
    created_at: row.created_at,
    read_at: row.read_at,
  };
}

export function adaptChatMentions(rows: ChatMentionRow[]): ChatMention[] {
  return rows.map(adaptChatMention);
}
