import type { ChatDecision } from '../../types/orgs';

// =============================================================================
// chatDecisionsAdapter — pure row mapper for `chat_decisions`. No Supabase
// import; data-only.
// =============================================================================

export interface ChatDecisionRow {
  id: string;
  title: string;
  rationale: string | null;
  org_id: string | null;
  protocol_id: string | null;
  source_org_message_id: string | null;
  source_protocol_message_id: string | null;
  decided_by_user_id: string | null;
  decided_at: string;
  created_by_user_id: string | null;
  created_at: string;
}

export function adaptChatDecision(row: ChatDecisionRow): ChatDecision {
  return {
    id: row.id,
    title: row.title,
    rationale: row.rationale,
    org_id: row.org_id,
    protocol_id: row.protocol_id,
    source_org_message_id: row.source_org_message_id,
    source_protocol_message_id: row.source_protocol_message_id,
    decided_by_user_id: row.decided_by_user_id,
    decided_at: row.decided_at,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
  };
}

export function adaptChatDecisions(rows: ChatDecisionRow[]): ChatDecision[] {
  return rows.map(adaptChatDecision);
}
