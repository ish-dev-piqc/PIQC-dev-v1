// =============================================================================
// types/actions — Context-Aware Action Layer (shared, non-mode).
//
// An ActionCard is PIQC's warm handoff: an evidence-backed "here is the next
// action and why" that links OUT to the system that actually executes it
// (travel tool, LMS, CTMS). PIQC suggests; it never books, schedules,
// approves, or enforces. Cards are derived deterministically from protocol
// facts by action_cards_sync — a card with no evidence and no deliverable
// behind it is a bug, not a feature.
//
// DB mirror: supabase/migrations/*_protocol_action_cards.sql.
// Design + decisions: plans/fable/action-layer.md.
// =============================================================================

/** Mirror of the external_destination_type CHECK constraint. */
export type ActionDestinationType = 'travel' | 'lms' | 'ctms' | 'none';

/**
 * Mirror of the status CHECK constraint. Draft-only doctrine extends here:
 * - suggested: PIQC surfaced it; the human decides.
 * - dismissed: hidden from the rail, preserved in the DB; re-sync refreshes
 *   its content but NEVER flips it back to suggested (no resurrection).
 * - acted: the user followed the link-out. A click record — PIQC does not
 *   claim the external action actually happened.
 */
export type ActionCardStatus = 'suggested' | 'dismissed' | 'acted';

export const DESTINATION_LABELS: Record<ActionDestinationType, string> = {
  travel: 'Travel planning',
  lms: 'Training',
  ctms: 'CTMS',
  none: 'External action',
};

/** Advisory-only window. v1 sync always writes NULL — protocol-only data
 *  cannot honestly suggest dates; the shape exists for the future
 *  operational-context overlay phase. */
export interface ActionSuggestedWindow {
  start_iso: string;
  end_iso: string;
}

/** Mirror of protocol_action_cards. */
export interface ActionCardRecord {
  id: string;
  protocol_id: string;
  /** Deliverable that anchored the card, if any (SET NULL on delete). */
  deliverable_id: string | null;
  /** Stable key, e.g. 'monitoring_prep'. One card per (protocol, trigger). */
  trigger_context: string;
  title: string;
  /** WHY now — deterministic prose assembled from real facts only. */
  rationale: string;
  /** Soft references into protocol_source_evidence (arrays cannot FK). */
  protocol_evidence_ids: string[];
  suggested_window: ActionSuggestedWindow | null;
  external_destination_type: ActionDestinationType;
  /** NULL until an org-level destination config exists (Decision 2) — the
   *  card then renders neutral guidance instead of a link-out. */
  external_url_or_template: string | null;
  /** Always rendered. Planning-support framing, never mandate/booking. */
  disclaimer: string;
  status: ActionCardStatus;
  created_at: string;
  updated_at: string;
}

/** action_cards_sync result. */
export interface ActionCardSyncResult {
  cards_created: number;
  cards_updated: number;
}

/** action_card_set_status result. */
export interface ActionCardStatusResult {
  card_id: string;
  status: ActionCardStatus;
}

/** Shared Result<T> for the actions API layer (canonical repo shape). */
export type ActionsResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// =============================================================================
// Protocol Awareness Layer — "What PIQC noticed".
//
// A Notice is the Action Layer's sibling: an OBSERVATION about a parsed
// protocol ("here is what I saw, with its evidence"), where an ActionCard is a
// warm handoff ("go do this there"). Notices carry no external destination, no
// link-out, no 'acted' state — observation only. Derived deterministically
// from already-extracted facts by protocol_notices_sync; a notice with no
// evidence behind it is a bug, not a feature.
//
// DB mirror: supabase/migrations/*_protocol_notices.sql.
// Design + decisions: plans/fable/protocol-awareness-layer.md.
// =============================================================================

/**
 * Mirror of the status CHECK constraint. Draft-only doctrine, narrower than a
 * card's:
 * - active: PIQC is currently observing this; the human decides.
 * - dismissed: hidden from the rail, preserved in the DB while the predicate
 *   holds; re-sync refreshes its content but NEVER flips it back to active. A
 *   predicate that drops to zero deletes the row entirely (observation of
 *   current truth), so a genuinely-new occurrence surfaces fresh.
 * There is no 'acted' — a notice is not a handoff, so nothing is followed.
 */
export type NoticeStatus = 'active' | 'dismissed';

/**
 * The v1 notice kinds emitted by protocol_notices_sync, in severity order.
 * Kept as a union for exhaustive client handling, but the adapter accepts any
 * non-empty string (the server owns the taxonomy; a new kind must render, not
 * be dropped — same anti-stale-whitelist discipline as the destination map).
 */
export type NoticeType =
  | 'tight_visit_window'
  | 'amendment_in_force'
  | 'endpoint_sdv'
  | 'low_confidence_extraction';

/** Mirror of protocol_notices. */
export interface NoticeRecord {
  id: string;
  protocol_id: string;
  /** Stable observation kind, e.g. 'tight_visit_window'. One per (protocol,
   *  notice_type). Widened to string: the server owns the taxonomy. */
  notice_type: NoticeType | string;
  /** Attention rank assigned by sync; lower surfaces first. */
  severity: number;
  headline: string;
  /** One-sentence observation — deterministic prose from real counts only. */
  detail: string;
  /** How many facts this notice summarizes (e.g. 3 tight-window visits). */
  observed_count: number;
  /** Soft references into protocol_source_evidence (arrays cannot FK). */
  protocol_evidence_ids: string[];
  status: NoticeStatus;
  created_at: string;
  updated_at: string;
}

/** protocol_notices_sync result. */
export interface NoticeSyncResult {
  notices_upserted: number;
  notices_deleted: number;
}

/** protocol_notice_set_status result. */
export interface NoticeStatusResult {
  notice_id: string;
  status: NoticeStatus;
}
