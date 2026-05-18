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
// Two contracts, both returning `Result<T>` per CLAUDE.md §"Result<T>
// in API layers". Neither throws — the API logs the error and returns
// the error variant, matching the canonical pattern in
// `src/lib/site/siteApi.ts`. The shell consumer silent-degrades on
// `!ok` (treats it as "no prior thread") so a permission-denied
// response can't crash the shell mount.
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

export type Result<T> =
  | { ok: true;  data: T }
  | { ok: false; error: string };

function fail<T>(label: string, error: unknown): Result<T> {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[piqcThreadApi] ${label}:`, error);
  return { ok: false, error: msg };
}

/**
 * Loads the persisted thread for an audit in turn-order. The shell
 * hydrates a freshly-mounted panel from this; an `ok: true, data: []`
 * is the correct "no prior thread" return.
 *
 * Defensive row-filtering on success: drop any row with an invalid
 * role or empty content. The CHECK constraint on the table prevents
 * these, but belt-and-suspenders against future schema drift.
 */
export async function fetchPiqcThread(
  auditId: string,
): Promise<Result<AuditChatMessage[]>> {
  const { data, error } = await supabase
    .from('piqc_thread_messages')
    .select('role, content, ordinal')
    .eq('audit_id', auditId)
    .order('ordinal', { ascending: true });

  if (error) return fail('fetchPiqcThread', error);

  const rows = (data ?? []) as Array<{
    role:    'user' | 'assistant';
    content: string;
    ordinal: number;
  }>;

  const messages = rows
    .filter((r) =>
      (r.role === 'user' || r.role === 'assistant') &&
      typeof r.content === 'string' &&
      r.content.length > 0,
    )
    .map((r) => ({ role: r.role, content: r.content }));

  return { ok: true, data: messages };
}

/**
 * Atomically replaces the thread with the given messages. The server-
 * side RPC handles ordinal assignment, so client and server can't
 * disagree about order across optimistic / final commits. Passing
 * `[]` is the canonical clear-thread path — same RPC, no second
 * code path.
 */
export async function savePiqcThread(
  auditId:  string,
  messages: AuditChatMessage[],
): Promise<Result<void>> {
  const { error } = await supabase.rpc('save_piqc_thread', {
    p_audit_id: auditId,
    p_messages: messages,
  });
  if (error) return fail('savePiqcThread', error);
  return { ok: true, data: undefined };
}
