// =============================================================================
// actionsApi — Context-Aware Action Layer client (ActionsResult<T> wrappers
// around the RPCs in supabase/migrations/*_protocol_action_cards.sql):
//   action_cards_sync       — DEFINER; deterministic card derivation.
//   action_cards_get        — INVOKER; jsonb array of cards.
//   action_card_set_status  — INVOKER; suggested/dismissed/acted.
//
// The adapter is invoked here so the rail only ever sees typed cards. No
// throw outside programmer-error guards; RPC errors surface as ok:false.
// Error strings carry the RPC message only — never card prose (SENSITIVE).
// =============================================================================

import { supabase } from '../supabase';
import type {
  ActionCardRecord,
  ActionCardStatus,
  ActionCardStatusResult,
  ActionCardSyncResult,
  ActionsResult,
  NoticeRecord,
  NoticeStatus,
  NoticeStatusResult,
  NoticeSyncResult,
} from '../../types/actions';
import { adaptActionCards, adaptNotices } from './actionsAdapter';

/**
 * Derive/refresh the protocol's action cards from its deliverables + facts.
 * Idempotent; a dismissed card is refreshed in place but stays dismissed
 * (never resurrected). Best-effort from the rail's perspective — callers
 * may tolerate failure and still render whatever action_cards_get returns.
 */
export async function syncActionCards(
  protocolId: string,
): Promise<ActionsResult<ActionCardSyncResult>> {
  const { data, error } = await supabase.rpc('action_cards_sync', {
    p_protocol_id: protocolId,
  });

  if (error) return { ok: false, error: error.message };

  const payload = data as Partial<ActionCardSyncResult> | null;
  return {
    ok: true,
    data: {
      cards_created:
        typeof payload?.cards_created === 'number' ? payload.cards_created : 0,
      cards_updated:
        typeof payload?.cards_updated === 'number' ? payload.cards_updated : 0,
    },
  };
}

/** Fetch the protocol's action cards (all statuses — the rail filters). */
export async function fetchActionCards(
  protocolId: string,
): Promise<ActionsResult<ActionCardRecord[]>> {
  const { data, error } = await supabase.rpc('action_cards_get', {
    p_protocol_id: protocolId,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: adaptActionCards(data) };
}

/** Flip a card's status. 'acted' is a click record, not workflow state. */
export async function setActionCardStatus(
  cardId: string,
  status: ActionCardStatus,
): Promise<ActionsResult<ActionCardStatusResult>> {
  const { data, error } = await supabase.rpc('action_card_set_status', {
    p_card_id: cardId,
    p_status: status,
  });

  if (error) return { ok: false, error: error.message };

  const payload = data as Partial<ActionCardStatusResult> | null;
  if (!payload || typeof payload.card_id !== 'string') {
    return { ok: false, error: 'malformed RPC response' };
  }
  return {
    ok: true,
    data: { card_id: payload.card_id, status: (payload.status ?? status) as ActionCardStatus },
  };
}

// ---------------------------------------------------------------------------
// Protocol Awareness Layer — notice wrappers (protocol_notices_sync/_get/
// _set_status in supabase/migrations/*_protocol_notices.sql). Same contract as
// the card wrappers: adapter invoked here so the rail only sees typed notices,
// RPC errors surface as ok:false, error strings carry the RPC message only.
// ---------------------------------------------------------------------------

/**
 * Derive/refresh the protocol's notices from its extracted facts. Idempotent;
 * a dismissed notice is refreshed in place but stays dismissed, and a notice
 * whose predicate drops to zero is DELETED (observation of current truth, not
 * a stale card). Surfaces the moment a protocol parses — no deliverable
 * dependency. Best-effort from the rail's perspective.
 */
export async function syncNotices(
  protocolId: string,
): Promise<ActionsResult<NoticeSyncResult>> {
  const { data, error } = await supabase.rpc('protocol_notices_sync', {
    p_protocol_id: protocolId,
  });

  if (error) return { ok: false, error: error.message };

  const payload = data as Partial<NoticeSyncResult> | null;
  return {
    ok: true,
    data: {
      notices_upserted:
        typeof payload?.notices_upserted === 'number' ? payload.notices_upserted : 0,
      notices_deleted:
        typeof payload?.notices_deleted === 'number' ? payload.notices_deleted : 0,
    },
  };
}

/** Fetch the protocol's notices (all statuses — the rail filters dismissed). */
export async function fetchNotices(
  protocolId: string,
): Promise<ActionsResult<NoticeRecord[]>> {
  const { data, error } = await supabase.rpc('protocol_notices_get', {
    p_protocol_id: protocolId,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: adaptNotices(data) };
}

/** Flip a notice's status. Only active/dismissed exist — no 'acted' (a notice
 *  is an observation, not a handoff). */
export async function setNoticeStatus(
  noticeId: string,
  status: NoticeStatus,
): Promise<ActionsResult<NoticeStatusResult>> {
  const { data, error } = await supabase.rpc('protocol_notice_set_status', {
    p_notice_id: noticeId,
    p_status: status,
  });

  if (error) return { ok: false, error: error.message };

  const payload = data as Partial<NoticeStatusResult> | null;
  if (!payload || typeof payload.notice_id !== 'string') {
    return { ok: false, error: 'malformed RPC response' };
  }
  return {
    ok: true,
    data: { notice_id: payload.notice_id, status: (payload.status ?? status) as NoticeStatus },
  };
}
