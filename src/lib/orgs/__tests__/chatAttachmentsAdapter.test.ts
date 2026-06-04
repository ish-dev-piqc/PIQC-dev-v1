import { describe, it, expect } from 'vitest';
import {
  adaptChatAttachment,
  adaptChatAttachments,
  type ChatAttachmentRow,
} from '../chatAttachmentsAdapter';

const baseOrgRow: ChatAttachmentRow = {
  id: 'a-1',
  org_message_id: 'msg-1',
  protocol_message_id: null,
  org_id: 'org-1',
  protocol_id: null,
  storage_path: 'user-1/abc-protocol-amendment.pdf',
  mime_type: 'application/pdf',
  size_bytes: 245678,
  original_filename: 'protocol-amendment.pdf',
  uploaded_by_user_id: 'user-1',
  created_at: '2026-06-04T12:00:00Z',
};

describe('chatAttachmentsAdapter', () => {
  it('maps all fields straight through for an org-channel attachment', () => {
    expect(adaptChatAttachment(baseOrgRow)).toEqual(baseOrgRow);
  });

  it('maps a protocol-channel attachment', () => {
    const row: ChatAttachmentRow = {
      ...baseOrgRow,
      id: 'a-2',
      org_message_id: null,
      org_id: null,
      protocol_message_id: 'pmsg-1',
      protocol_id: 'proto-1',
    };
    expect(adaptChatAttachment(row).protocol_id).toBe('proto-1');
    expect(adaptChatAttachment(row).protocol_message_id).toBe('pmsg-1');
  });

  it('preserves null uploader (auth.users deletion)', () => {
    const row = { ...baseOrgRow, uploaded_by_user_id: null };
    expect(adaptChatAttachment(row).uploaded_by_user_id).toBeNull();
  });

  it('handles empty array', () => {
    expect(adaptChatAttachments([])).toEqual([]);
  });

  it('maps multiple rows preserving order', () => {
    const rows: ChatAttachmentRow[] = [
      baseOrgRow,
      { ...baseOrgRow, id: 'a-2', original_filename: 'screenshot.png', mime_type: 'image/png' },
    ];
    const result = adaptChatAttachments(rows);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a-1');
    expect(result[1].mime_type).toBe('image/png');
  });
});
