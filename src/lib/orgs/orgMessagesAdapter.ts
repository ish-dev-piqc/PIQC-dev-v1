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
}

export function adaptOrgMessage(row: OrgMessageRow): OrgMessage {
  return {
    id: row.id,
    org_id: row.org_id,
    author_user_id: row.author_user_id,
    body: row.body,
    created_at: row.created_at,
  };
}

export function adaptOrgMessages(rows: OrgMessageRow[]): OrgMessage[] {
  return rows.map(adaptOrgMessage);
}
