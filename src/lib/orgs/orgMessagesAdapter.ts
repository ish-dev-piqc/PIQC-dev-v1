import type { OrgMessage } from '../../types/orgs';

// =============================================================================
// orgMessagesAdapter — pure mapper from the raw `org_messages` row shape
// returned by Supabase to the typed OrgMessage interface. No Supabase
// import here; this file is data-only.
// =============================================================================

export interface OrgMessageRow {
  id: string;
  org_id: string;
  author_user_id: string | null;
  body: string;
  created_at: string;
  // Added in 20260704000200_chat_polish_v2.sql; optional on the row type so
  // adapters don't blow up against legacy selects that don't request them.
  edited_at?: string | null;
  deleted_at?: string | null;
  // Added in 20260704000300_chat_thread_replies.sql.
  parent_message_id?: string | null;
}

export function adaptOrgMessage(row: OrgMessageRow): OrgMessage {
  return {
    id: row.id,
    org_id: row.org_id,
    author_user_id: row.author_user_id,
    body: row.body,
    created_at: row.created_at,
    edited_at: row.edited_at ?? null,
    deleted_at: row.deleted_at ?? null,
    parent_message_id: row.parent_message_id ?? null,
  };
}

export function adaptOrgMessages(rows: OrgMessageRow[]): OrgMessage[] {
  return rows.map(adaptOrgMessage);
}
