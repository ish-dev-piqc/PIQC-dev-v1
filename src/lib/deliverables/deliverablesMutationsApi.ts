// =============================================================================
// deliverablesMutationsApi — Protocol Deliverable Engine mutation layer.
//
// DeliverablesResult<T> wrappers around the block-mutation RPCs (defined in
// supabase/migrations/20260708000100_deliverable_rpcs.sql):
//   deliverable_set_block_review — all non-edit review actions (mark/unmark
//                                  reviewed, flag, add_note, reject_block).
//   deliverable_edit_block_text  — text overlay + version bump.
//   deliverable_add_block        — appends a human_editorial block.
//   deliverable_delete_block     — hard delete, human_added blocks only
//                                  (parser-derived blocks are REJECTED via
//                                  rejectBlock so regeneration remembers).
//
// Every RPC appends its own deliverable_block_edits audit row — nothing to
// do client-side. Draft-only vocabulary: 'reviewed' is human sign-off on a
// draft, never approval.
//
// No throw outside programmer-error guards. SENSITIVE: note/text bodies flow
// through here — never log them (error strings carry RPC messages only).
// =============================================================================

import { supabase } from '../supabase';
import type {
  DeliverableBlockMutationResult,
  DeliverableReviewAction,
  DeliverableReviewState,
  DeliverablesResult,
} from '../../types/deliverables';

/**
 * Narrow a mutation RPC's JSON to DeliverableBlockMutationResult. Malformed
 * payloads become ok:false rather than crashing the caller.
 */
function adaptMutationPayload(
  data: unknown,
): DeliverablesResult<DeliverableBlockMutationResult> {
  const payload = data as Partial<DeliverableBlockMutationResult> | null;
  if (
    !payload ||
    typeof payload.block_id !== 'string' ||
    typeof payload.review_state !== 'string'
  ) {
    return { ok: false, error: 'malformed RPC response' };
  }

  return {
    ok: true,
    data: {
      block_id: payload.block_id,
      review_state: payload.review_state as DeliverableReviewState,
      version: typeof payload.version === 'number' ? payload.version : 0,
      edit_id: typeof payload.edit_id === 'string' ? payload.edit_id : '',
    },
  };
}

/**
 * Internal: dispatch one deliverable_set_block_review call. The RPC maps the
 * action to the new review_state, stores the note (add_note only — other
 * actions carry it on the audit row alone), and appends the audit entry.
 */
async function dispatchReviewAction(
  blockId: string,
  action: DeliverableReviewAction,
  note?: string,
): Promise<DeliverablesResult<DeliverableBlockMutationResult>> {
  const { data, error } = await supabase.rpc('deliverable_set_block_review', {
    p_block_id: blockId,
    p_action: action,
    p_note: note ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return adaptMutationPayload(data);
}

/** Mark a block reviewed (human sign-off on the draft) → review_state 'reviewed'. */
export function markBlockReviewed(
  blockId: string,
): Promise<DeliverablesResult<DeliverableBlockMutationResult>> {
  return dispatchReviewAction(blockId, 'mark_reviewed');
}

/** Undo a review mark → review_state back to 'draft'. */
export function unmarkBlockReviewed(
  blockId: string,
): Promise<DeliverablesResult<DeliverableBlockMutationResult>> {
  return dispatchReviewAction(blockId, 'unmark_reviewed');
}

/** Flag a block for a closer look → 'needs_review'. Optional note lands on
 *  the audit row (not the block). */
export function flagBlock(
  blockId: string,
  note?: string,
): Promise<DeliverablesResult<DeliverableBlockMutationResult>> {
  return dispatchReviewAction(blockId, 'flag', note);
}

/** Attach a reviewer note to a block (review_state unchanged; the RPC sets
 *  review_note on the row and appends the audit entry). */
export function addBlockNote(
  blockId: string,
  note: string,
): Promise<DeliverablesResult<DeliverableBlockMutationResult>> {
  return dispatchReviewAction(blockId, 'add_note', note);
}

/** Reject a parser-derived block → 'rejected'. Hidden from packet/export but
 *  kept in the DB so regeneration never resurrects it. */
export function rejectBlock(
  blockId: string,
  note?: string,
): Promise<DeliverablesResult<DeliverableBlockMutationResult>> {
  return dispatchReviewAction(blockId, 'reject_block', note);
}

/**
 * Set the human text overlay on a block (current_text; derived_text stays
 * frozen). The RPC bumps version, flips review_state to 'edited', and records
 * the previous/new text pair in the audit trail.
 */
export async function editBlockText(
  blockId: string,
  newText: string,
  note?: string,
): Promise<DeliverablesResult<DeliverableBlockMutationResult>> {
  // Programmer-error guard — the RPC rejects empty too, but a client-side
  // guard saves a round-trip and gives a cleaner error.
  const trimmed = newText.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'editBlockText requires non-empty new text' };
  }

  const { data, error } = await supabase.rpc('deliverable_edit_block_text', {
    p_block_id: blockId,
    p_new_text: trimmed,
    p_note: note ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return adaptMutationPayload(data);
}

/**
 * Append a human_editorial checklist block to a section. The RPC stores the
 * text in current_text (derived_text stays NULL — there is no parser text),
 * sets review_state 'human_added', and regeneration never touches it.
 */
export async function addBlock(
  deliverableId: string,
  sectionKey: string,
  text: string,
  note?: string,
): Promise<DeliverablesResult<DeliverableBlockMutationResult>> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'addBlock requires non-empty text' };
  }

  const { data, error } = await supabase.rpc('deliverable_add_block', {
    p_deliverable_id: deliverableId,
    p_section_key: sectionKey,
    p_text: trimmed,
    p_note: note ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return adaptMutationPayload(data);
}

/**
 * Hard-delete a block. The RPC allows this ONLY for human_added blocks —
 * parser-derived blocks must go through rejectBlock so their absence is
 * remembered across regeneration.
 */
export async function deleteBlock(
  blockId: string,
): Promise<DeliverablesResult<{ block_id: string }>> {
  const { data, error } = await supabase.rpc('deliverable_delete_block', {
    p_block_id: blockId,
  });

  if (error) return { ok: false, error: error.message };

  const payload = data as { block_id?: unknown } | null;
  if (!payload || typeof payload.block_id !== 'string') {
    return { ok: false, error: 'malformed RPC response' };
  }
  return { ok: true, data: { block_id: payload.block_id } };
}
