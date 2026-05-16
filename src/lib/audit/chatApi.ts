import { supabase } from '../supabase';

// =============================================================================
// Audit Mode Chat API (F-3)
//
// Thin client wrapper around the `audit-mode-chat` edge function. Sends the
// audit_id + full thread of prior turns; receives one assistant reply.
//
// Doctrine reminders:
//   - The wrapper is read-only. It does NOT persist messages anywhere. The
//     calling component owns the in-memory thread for the audit session.
//   - Errors throw — callers decide whether to display, retry, or fall back.
//   - Auth is JWT pass-through, mirroring requestLlmSection in reportApi.ts.
// =============================================================================

export type AuditChatRole = 'user' | 'assistant';
export interface AuditChatMessage {
  role:    AuditChatRole;
  content: string;
}

export class AuditChatError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuditChatError';
    this.status = status;
  }
}

/**
 * Send the next turn in an audit-mode chat.
 *
 * @param auditId     Audit being discussed; server validates RLS access.
 * @param messages    Full conversation so far. Last entry MUST be a user turn —
 *                    the edge function rejects anything else with a 400. Caller
 *                    is responsible for trimming if the thread grows past the
 *                    server's MAX_MESSAGES cap.
 * @param viewedStage Optional. The stage the auditor is currently looking at
 *                    in the workspace. Distinct from the audit's `current_stage`
 *                    (auditors revisit earlier stages). Server uses this to
 *                    bias the relevance of its replies; not used for any data
 *                    fetch decision. Server validates against an allow-list.
 * @returns the assistant's reply text (trimmed)
 * @throws AuditChatError on any non-2xx response or empty payload
 */
export async function requestAuditChat(
  auditId:     string,
  messages:    AuditChatMessage[],
  viewedStage?: string,
): Promise<string> {
  const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? supabaseAnonKey;

  // Spread viewed_stage conditionally so the body shape is unchanged for
  // callers that haven't been updated yet — preserves wire-level back-compat
  // with PR #73's body contract.
  const requestBody: { audit_id: string; messages: AuditChatMessage[]; viewed_stage?: string } = {
    audit_id: auditId,
    messages,
  };
  if (viewedStage) requestBody.viewed_stage = viewedStage;

  const res = await fetch(`${supabaseUrl}/functions/v1/audit-mode-chat`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const data = (await res.json().catch(() => ({}))) as {
    reply?: string;
    error?: string;
  };

  if (!res.ok) {
    throw new AuditChatError(
      data.error || `Chat service returned ${res.status}`,
      res.status,
    );
  }
  if (!data.reply) {
    throw new AuditChatError('Chat service returned empty reply', 502);
  }
  return data.reply;
}
