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
