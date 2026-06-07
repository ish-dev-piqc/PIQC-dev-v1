import type { ProtocolMessage } from '../../types/orgs';

// =============================================================================
// protocolMessagesAdapter — pure mapper from the raw `protocol_messages` row
// shape returned by Supabase to the typed ProtocolMessage interface. No
// Supabase import here; this file is data-only.
// =============================================================================

export interface ProtocolMessageRow {
  id: string;
  protocol_id: string;
  author_user_id: string | null;
  body: string;
  created_at: string;
  // Added in 20260704000200_chat_polish_v2.sql.
  edited_at?: string | null;
  deleted_at?: string | null;
  // Added in 20260704000300_chat_thread_replies.sql.
  parent_message_id?: string | null;
}

export function adaptProtocolMessage(row: ProtocolMessageRow): ProtocolMessage {
  return {
    id: row.id,
    protocol_id: row.protocol_id,
    author_user_id: row.author_user_id,
    body: row.body,
    created_at: row.created_at,
    edited_at: row.edited_at ?? null,
    deleted_at: row.deleted_at ?? null,
    parent_message_id: row.parent_message_id ?? null,
  };
}

export function adaptProtocolMessages(rows: ProtocolMessageRow[]): ProtocolMessage[] {
  return rows.map(adaptProtocolMessage);
}
