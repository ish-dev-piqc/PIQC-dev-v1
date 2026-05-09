// =============================================================================
// Source of Truth Reviewer — draft review API (PR-5).
//
// Wraps sotr_create_review_event. All five draft review actions
// (accept_for_draft, edit_draft_item, reject_from_draft, flag_item,
// flag_source) flow through this single function.
//
// PIQC is a drafting + review aid. These are NOT regulated approvals,
// signatures, or release events. Naming uses "draft review" deliberately.
//
// Safe logging: never log reviewer_note or new_item_text bodies — only
// counts/IDs and the action name.
// =============================================================================

import { supabase } from '../supabase';
import type {
  CreateReviewEventInput,
  CreateReviewEventResult,
  DraftReviewAction,
} from '../../types/sotr';

const ACTIONS_REQUIRING_NEW_TEXT: ReadonlySet<DraftReviewAction> =
  new Set<DraftReviewAction>(['edit_draft_item']);

/** Thrown by the client wrapper before hitting the RPC. */
export class ReviewActionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewActionValidationError';
  }
}

/**
 * Creates a draft review event for a worksheet item.
 *
 * Validates the request shape client-side before round-tripping. The RPC
 * does the same checks server-side (defence in depth) and additionally
 * verifies study membership + source-evidence ownership.
 */
export async function createReviewEvent(
  studyId: string,
  worksheetItemId: string,
  input: CreateReviewEventInput,
): Promise<CreateReviewEventResult> {
  // Client-side validation: keeps the round trip cheap on obvious misuse.
  if (ACTIONS_REQUIRING_NEW_TEXT.has(input.action)) {
    if (!input.new_item_text || input.new_item_text.trim().length === 0) {
      throw new ReviewActionValidationError(
        `${input.action} requires non-empty new_item_text`,
      );
    }
  }

  const { data, error } = await supabase.rpc('sotr_create_review_event', {
    p_study_id:                    studyId,
    p_worksheet_item_id:           worksheetItemId,
    p_action:                      input.action,
    p_new_item_text:               input.new_item_text             ?? null,
    p_reviewer_note:               input.reviewer_note              ?? null,
    p_source_evidence_record_ids:  input.source_evidence_record_ids ?? [],
  });

  if (error) throw error;

  // Safe log: counts + action only — never the note body or new text.
  console.info('[sotr] draft review event created', {
    studyId,
    worksheetItemId,
    action:           input.action,
    sourceCount:      input.source_evidence_record_ids?.length ?? 0,
    hasNote:          Boolean(input.reviewer_note?.trim().length),
    noteLength:       input.reviewer_note?.trim().length ?? 0,
    newTextLength:    input.new_item_text?.length ?? 0,
  });

  return data as CreateReviewEventResult;
}
