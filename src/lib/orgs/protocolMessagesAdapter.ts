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
}

export function adaptProtocolMessage(row: ProtocolMessageRow): ProtocolMessage {
  return {
    id: row.id,
    protocol_id: row.protocol_id,
    author_user_id: row.author_user_id,
    body: row.body,
    created_at: row.created_at,
  };
}

export function adaptProtocolMessages(rows: ProtocolMessageRow[]): ProtocolMessage[] {
  return rows.map(adaptProtocolMessage);
}
