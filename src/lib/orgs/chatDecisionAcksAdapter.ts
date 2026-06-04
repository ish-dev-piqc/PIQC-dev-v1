import type { ChatDecisionAck } from '../../types/orgs';

// =============================================================================
// chatDecisionAcksAdapter — pure row mapper for chat_decision_acks. No
// Supabase import; data-only.
// =============================================================================

export interface ChatDecisionAckRow {
  id: string;
  decision_id: string;
  required_user_id: string;
  acknowledged_at: string | null;
  acknowledged_note: string | null;
  created_at: string;
}

export function adaptChatDecisionAck(row: ChatDecisionAckRow): ChatDecisionAck {
  return {
    id: row.id,
    decision_id: row.decision_id,
    required_user_id: row.required_user_id,
    acknowledged_at: row.acknowledged_at,
    acknowledged_note: row.acknowledged_note,
    created_at: row.created_at,
  };
}

export function adaptChatDecisionAcks(rows: ChatDecisionAckRow[]): ChatDecisionAck[] {
  return rows.map(adaptChatDecisionAck);
}
