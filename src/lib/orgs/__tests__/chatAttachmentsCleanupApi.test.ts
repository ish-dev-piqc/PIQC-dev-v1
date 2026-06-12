import { beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// chatAttachmentsCleanupApi — smoke tests. Behaviour of the underlying
// SECURITY DEFINER RPCs (admin gating, storage.objects DELETE) is covered
// by the migration's verification block + manual test plan in
// plans/kiara/chat-storage-orphan-cleanup.md.
// =============================================================================

const rpcMock = vi.fn();

vi.mock('../../supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

describe('chatAttachmentsCleanupApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports both helpers', async () => {
    const m = await import('../chatAttachmentsCleanupApi');
    expect(typeof m.countOrphanChatAttachments).toBe('function');
    expect(typeof m.deleteOrphanChatAttachments).toBe('function');
  });

  it('countOrphanChatAttachments returns the integer scalar', async () => {
    rpcMock.mockResolvedValueOnce({ data: 5, error: null });
    const { countOrphanChatAttachments } = await import('../chatAttachmentsCleanupApi');
    const res = await countOrphanChatAttachments();
    expect(rpcMock).toHaveBeenCalledWith('count_orphan_chat_attachments');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBe(5);
  });

  it('countOrphanChatAttachments unwraps wrapped scalar shapes', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { count_orphan_chat_attachments: 7 },
      error: null,
    });
    const { countOrphanChatAttachments } = await import('../chatAttachmentsCleanupApi');
    const res = await countOrphanChatAttachments();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBe(7);
  });

  it('countOrphanChatAttachments surfaces RPC errors', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied' },
    });
    const { countOrphanChatAttachments } = await import('../chatAttachmentsCleanupApi');
    const res = await countOrphanChatAttachments();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('permission denied');
  });

  it('deleteOrphanChatAttachments returns the deleted count', async () => {
    rpcMock.mockResolvedValueOnce({ data: 3, error: null });
    const { deleteOrphanChatAttachments } = await import('../chatAttachmentsCleanupApi');
    const res = await deleteOrphanChatAttachments();
    expect(rpcMock).toHaveBeenCalledWith('delete_orphan_chat_attachments');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBe(3);
  });

  it('deleteOrphanChatAttachments surfaces RPC errors', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'rls violation' },
    });
    const { deleteOrphanChatAttachments } = await import('../chatAttachmentsCleanupApi');
    const res = await deleteOrphanChatAttachments();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('rls violation');
  });

  it('handles null data gracefully by returning 0', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { countOrphanChatAttachments } = await import('../chatAttachmentsCleanupApi');
    const res = await countOrphanChatAttachments();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBe(0);
  });
});
