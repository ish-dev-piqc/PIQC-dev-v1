import { supabase } from '../supabase';
import type { Result } from './orgsApi';

// =============================================================================
// chatAttachmentsCleanupApi — wrappers for the two orphan-cleanup RPCs.
//
// Both are admin-gated server-side. The client surface is intentionally
// thin: both RPCs return an integer count. No adapter — there's no row
// shape to normalize.
// =============================================================================

export async function countOrphanChatAttachments(): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('count_orphan_chat_attachments');
  if (error) return { ok: false, error: error.message };
  // Postgres returns the integer scalar as-is; coerce defensively in case
  // PostgREST wraps it (some bindings emit { count_orphan_chat_attachments: n }).
  if (typeof data === 'number') return { ok: true, data };
  if (data && typeof data === 'object' && 'count_orphan_chat_attachments' in data) {
    const v = (data as Record<string, unknown>).count_orphan_chat_attachments;
    if (typeof v === 'number') return { ok: true, data: v };
  }
  return { ok: true, data: 0 };
}

export async function deleteOrphanChatAttachments(): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('delete_orphan_chat_attachments');
  if (error) return { ok: false, error: error.message };
  if (typeof data === 'number') return { ok: true, data };
  if (data && typeof data === 'object' && 'delete_orphan_chat_attachments' in data) {
    const v = (data as Record<string, unknown>).delete_orphan_chat_attachments;
    if (typeof v === 'number') return { ok: true, data: v };
  }
  return { ok: true, data: 0 };
}
