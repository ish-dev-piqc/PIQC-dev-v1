// =============================================================================
// Visit Execution Workspace — Mutations API.
//
// Result<T> wrappers around the Sprint 2.5 RPC visit_execution_set_review_status
// (defined in supabase/migrations/20260601000600_visit_execution_rpcs.sql).
// The RPC handles ownership gating + the visit_requirement_human_edits append.
//
// Sprint 4a wires the click handlers in VisitExecutionTab to these wrappers.
// Sprint 4b (next PR) will add visitExecutionEditTextApi for edit_text +
// site-note text input — those need separate UI plumbing.
//
// Mock-mode short-circuit: when piq-visit-execution-mock-v1 is on, mutations
// return a synthetic success without hitting Supabase. Demo mode mutates the
// in-memory view without DB writes.
//
// No throw outside programmer-error guards (CLAUDE.md API convention).
// =============================================================================

import { supabase } from '../supabase';
import type { Result } from '../site/siteApi';
import type { ExecutionReviewStatus } from '../../types/visit-execution';
import { isMockEnabled } from './visitExecutionApi';

/**
 * Result shape returned by visit_execution_set_review_status. Mirrors the
 * RPC's RETURNS JSON contract:
 *   {
 *     requirement_id: uuid,
 *     review_status:  execution_review_status,
 *     version:        integer,
 *     event_id:       uuid
 *   }
 *
 * `version` increments only on edit_text actions (which go through a
 * different RPC — visit_execution_edit_text — added in Sprint 4b). For the
 * actions in this module, version stays at the row's prior value.
 */
export interface VisitRequirementMutationResult {
  requirement_id: string;
  review_status: ExecutionReviewStatus;
  version: number;
  event_id: string;
}

/**
 * Internal: dispatch one set_review_status RPC call. Mock-mode synthesizes
 * a success without network. Real-mode delegates to supabase.rpc and surfaces
 * errors as Result<>.
 */
async function dispatchReviewAction(
  requirementId: string,
  action:
    | 'mark_reviewed'
    | 'unmark_reviewed'
    | 'flag_for_review'
    | 'mark_needs_clarification'
    | 'add_site_note',
  nextStatusForMock: ExecutionReviewStatus,
  note?: string,
): Promise<Result<VisitRequirementMutationResult>> {
  if (isMockEnabled()) {
    return {
      ok: true,
      data: {
        requirement_id: requirementId,
        review_status: nextStatusForMock,
        version: 1,
        event_id: `mock-event-${action}-${requirementId}`,
      },
    };
  }

  const { data, error } = await supabase.rpc(
    'visit_execution_set_review_status',
    {
      p_requirement_id: requirementId,
      p_action: action,
      p_note: note ?? null,
    },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  // The RPC returns JSON. Defensive narrowing: if the shape isn't what we
  // expect, treat as ok:false rather than crash the caller.
  const payload = data as Partial<VisitRequirementMutationResult> | null;
  if (
    !payload ||
    typeof payload.requirement_id !== 'string' ||
    typeof payload.review_status !== 'string'
  ) {
    return { ok: false, error: 'malformed RPC response' };
  }

  return {
    ok: true,
    data: {
      requirement_id: payload.requirement_id,
      review_status: payload.review_status as ExecutionReviewStatus,
      version: typeof payload.version === 'number' ? payload.version : 0,
      event_id: typeof payload.event_id === 'string' ? payload.event_id : '',
    },
  };
}

/**
 * Mark a requirement reviewed. RPC writes review_status = 'reviewed' on the
 * row + appends a 'mark_reviewed' event to visit_requirement_human_edits.
 */
export function markReviewed(
  requirementId: string,
): Promise<Result<VisitRequirementMutationResult>> {
  return dispatchReviewAction(requirementId, 'mark_reviewed', 'reviewed');
}

/**
 * Unmark a previously-reviewed requirement. RPC writes review_status =
 * 'not_reviewed' + appends an 'unmark_reviewed' event.
 */
export function unmarkReviewed(
  requirementId: string,
): Promise<Result<VisitRequirementMutationResult>> {
  return dispatchReviewAction(requirementId, 'unmark_reviewed', 'not_reviewed');
}

/**
 * Flag a requirement for further review. RPC writes review_status =
 * 'needs_review' + appends a 'flag_for_review' event. Optional note attaches
 * to the audit log entry (not displayed on the row in 4a — Sprint 4b adds
 * the note read-surface).
 */
export function flagForReview(
  requirementId: string,
  note?: string,
): Promise<Result<VisitRequirementMutationResult>> {
  return dispatchReviewAction(requirementId, 'flag_for_review', 'needs_review', note);
}

/**
 * Mark a requirement as needing clarification (e.g. from sponsor / investigator).
 * Semantically identical to flag_for_review at the DB layer (both set
 * review_status = 'needs_review') but the audit log distinguishes them via
 * action enum.
 */
export function markNeedsClarification(
  requirementId: string,
  note?: string,
): Promise<Result<VisitRequirementMutationResult>> {
  return dispatchReviewAction(
    requirementId,
    'mark_needs_clarification',
    'needs_review',
    note,
  );
}

/**
 * Add a site-specific note to a requirement. RPC writes review_status =
 * 'site_note_added' + sets review_note column + appends an 'add_site_note'
 * event. Sprint 4a exports this for API completeness but no UI calls it yet
 * — Sprint 4b adds the note-input UI.
 */
export function addSiteNote(
  requirementId: string,
  note: string,
): Promise<Result<VisitRequirementMutationResult>> {
  return dispatchReviewAction(
    requirementId,
    'add_site_note',
    'site_note_added',
    note,
  );
}
