import type { ChatAttachment } from '../../types/orgs';

// =============================================================================
// chatAttachmentsAdapter — pure mapper for `chat_attachments`. No Supabase
// import; data-only.
// =============================================================================

export interface ChatAttachmentRow {
  id: string;
  org_message_id: string | null;
  protocol_message_id: string | null;
  org_id: string | null;
  protocol_id: string | null;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  original_filename: string;
  uploaded_by_user_id: string | null;
  created_at: string;
}

export function adaptChatAttachment(row: ChatAttachmentRow): ChatAttachment {
  return {
    id: row.id,
    org_message_id: row.org_message_id,
    protocol_message_id: row.protocol_message_id,
    org_id: row.org_id,
    protocol_id: row.protocol_id,
    storage_path: row.storage_path,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    original_filename: row.original_filename,
    uploaded_by_user_id: row.uploaded_by_user_id,
    created_at: row.created_at,
  };
}

export function adaptChatAttachments(rows: ChatAttachmentRow[]): ChatAttachment[] {
  return rows.map(adaptChatAttachment);
}
