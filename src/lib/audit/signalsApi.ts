import { supabase } from '../supabase';

// =============================================================================
// PIQC ambient signals — derived attention cues.
//
// PIQC observes the audit's state and surfaces high-signal nudges to the
// auditor via a dot on the dock + a one-line summary inside the panel's
// empty state. Per the doctrine:
//
//   - Signals are DERIVED, never stored. Re-fetched on each shell load.
//   - The auditor decides what to do with a signal. PIQC never auto-acts.
//   - False-positive tolerance is LOW — a noisy dot trains the auditor to
//     ignore it, and PIQC's quietest UX becomes useless. We only surface
//     facts the auditor would themselves call "yes, I should look at that."
//
// v1 ships two signals:
//   1. SOTR items awaiting review (sourced from useWorksheetReviewCount,
//      already wired in the shell — no new fetch here)
//   2. Questionnaire responses the auditor flagged as inconsistent
//      (this file's job — lightweight count query)
//
// Future signals (intentionally deferred until v1 proves value):
//   - Workspace entries left NOT_YET_CLASSIFIED past a threshold
//   - Long idle on a stage without writing
//   - Draft text that contradicts an approved questionnaire response
//   - Stage-filtered relevance (only surface signals matching viewed_stage)
// =============================================================================

/**
 * Count of questionnaire responses where the auditor set inconsistency_flag=true.
 *
 * These are the auditor's OWN flags — re-surfacing them is honest signal,
 * not invented attention. Returns 0 on any error (silent degradation; a
 * missing signal is better than a blocking error in the shoulder UX).
 */
export async function countQuestionnaireFlaggedResponses(
  auditId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('questionnaire_response_objects')
    .select('id', { count: 'exact', head: true })
    .eq('audit_id', auditId)
    .eq('inconsistency_flag', true);

  if (error) {
    // RLS denial / network error / table-not-found-yet — log once and
    // return 0 so the dock stays calm instead of throwing into a render.
    console.error('[signalsApi] countQuestionnaireFlaggedResponses error:', error);
    return 0;
  }
  return count ?? 0;
}
