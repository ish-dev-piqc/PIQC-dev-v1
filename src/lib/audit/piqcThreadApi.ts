import { supabase } from '../supabase';
import type { AuditChatMessage } from './chatApi';

// =============================================================================
// PIQC thread persistence — closes the amnesia gap.
//
// The F-3 chat thread used to live only in shell state — refresh, sign
// back in, or close the tab and it was gone. This module persists the
// thread per audit via `piqc_thread_messages` so an auditor returning
// to an audit picks up exactly where they left off.
//
// Two contracts, both silent-degrade:
//
//   - fetchPiqcThread(auditId) → ordered messages, or [] on error
//   - savePiqcThread(auditId, messages) → void, swallows errors + logs
//
// (Clearing a thread is just `savePiqcThread(auditId, [])` — the RPC
// treats whole-replace-with-empty as delete. Not introducing a third
// named helper for one line of forwarding.)
//
// Silent-degrade matches the dock-signal doctrine (signalsApi.ts): a
// thrown error from a permission-denied response would crash the shell
// mount, and the chat panel's quietest fallback is "no prior thread"
// not "Application Error." Persistence failures show up in dev consoles
// + Supabase logs; they don't surface to the auditor.
//
// Doctrine alignment:
//   - PIQC observes, doesn't create — the persistence is mirrored
//     state, never invented. The auditor's words and PIQC's replies
//     are both in the thread; nothing else lands here.
//   - PHI/PII: chat content can carry observation_text per founder
//     decision #6. Same RLS gate as the audits row itself.
//   - Counts-only logging: error path logs the error message only;
//     thread content never goes to logs.
// =============================================================================

/**
 * Loads the persisted thread for an audit in turn-order. Returns [] on
 * error, missing thread, or RLS denial — never throws. The shell uses
 * this to populate a freshly-mounted panel; an empty return is
 * indistinguishable from "no prior thread" which is the correct UX.
 */
export async function fetchPiqcThread(
  auditId: string,
): Promise<AuditChatMessage[]> {
  const { data, error } = await supabase
    .from('piqc_thread_messages')
    .select('role, content, ordinal')
    .eq('audit_id', auditId)
    .order('ordinal', { ascending: true });

  if (error) {
    console.error('[piqcThreadApi] fetchPiqcThread error:', error);
    return [];
  }

  const rows = (data ?? []) as Array<{
    role:    'user' | 'assistant';
    content: string;
    ordinal: number;
  }>;

  // Defensive: drop any row that doesn't satisfy the panel's message
  // shape. The CHECK constraint on the table prevents malformed roles,
  // but we belt-and-suspender in case a future migration loosens the
  // shape without updating this client.
  return rows
    .filter((r) =>
      (r.role === 'user' || r.role === 'assistant') &&
      typeof r.content === 'string' &&
      r.content.length > 0,
    )
    .map((r) => ({ role: r.role, content: r.content }));
}

/**
 * Atomically replaces the thread with the given messages. The server-
 * side RPC handles ordinal assignment, so client and server can't
 * disagree about order even across optimistic / final commits.
 *
 * Swallows all errors — see module doctrine. The caller (shell) does
 * not need to handle a rejected promise; persistence failure is a quiet
 * background concern, not an auditor-facing event.
 */
export async function savePiqcThread(
  auditId:  string,
  messages: AuditChatMessage[],
): Promise<void> {
  const { error } = await supabase.rpc('save_piqc_thread', {
    p_audit_id: auditId,
    p_messages: messages,
  });
  if (error) {
    console.error('[piqcThreadApi] savePiqcThread error:', error);
  }
}

