import { supabase } from '../supabase';

// =============================================================================
// PIQC ambient signals — derived attention cues, now with thematic clustering.
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
// v1 shipped two raw-count signals. v2 (this file) adds THEMATIC HINTS on
// top of the counts so PIQC reads as "noticed a pattern" instead of "knows
// arithmetic":
//
//   before  →  "3 items awaiting your review"
//   after   →  "3 items awaiting your review"
//              "2 about visit schedule"
//
// Doctrine alignment for themes:
//   - Themes are FIELD VALUES of the underlying rows (SOTR `field_type`
//     enum; questionnaire `section_title` string). Not LLM inferences.
//     This keeps PIQC's "observes, doesn't create" line intact — the
//     theme is evidence, not draft logic.
//   - Hints are HINTS. The full count + "Take me there →" affordance
//     still go to the actual review queue where the auditor sees the
//     real items. Wrong theming costs the auditor one extra glance, not
//     a wrong decision.
//   - Honesty chip ("AI · advisory") on the panel already covers themed
//     copy; no new disclosure surface needed.
//
// Future signals (intentionally deferred until v2 proves value):
//   - Workspace entries left NOT_YET_CLASSIFIED past a threshold
//   - Long idle on a stage without writing
//   - Draft text that contradicts an approved questionnaire response
//   - Stage-filtered relevance (only surface signals matching viewed_stage)
// =============================================================================

/**
 * A single themed cluster within a signal. `label` is human-readable;
 * `count` is items in that cluster. Sorted descending by count by the
 * fetcher.
 */
export interface SignalTheme {
  label: string;
  count: number;
}

export interface FlaggedResponsesSignal {
  count:  number;
  themes: SignalTheme[];
}

export interface SotrAwaitingReviewSignal {
  /** == awaitingReview from the SOTR helper, but PIQC-owned fetch path. */
  count:  number;
  themes: SignalTheme[];
}

const EMPTY_FLAGGED: FlaggedResponsesSignal = { count: 0, themes: [] };
const EMPTY_SOTR:    SotrAwaitingReviewSignal = { count: 0, themes: [] };

// -----------------------------------------------------------------------------
// SOTR field_type → human label.
//
// `protocol_extracted_items.field_type` is a free TEXT column today but
// the SOTR extractor populates it from a closed enum (see migration
// 20260508000000_sotr_schema.sql:104). This map covers that enum. If the
// dev team adds a new field_type value, we surface it as "other" + log a
// warning so the PIQC label map can be updated in a follow-up.
//
// Decision debt named here: PIQC's label map may lag the SOTR enum. The
// fallback ("other") is a visible, observable failure, not a silent one.
// -----------------------------------------------------------------------------
const SOTR_FIELD_TYPE_LABELS: Record<string, string> = {
  endpoint:  'endpoints',
  criterion: 'eligibility criteria',
  visit:     'visit schedule',
  dosing:    'dosing',
  metadata:  'study metadata',
};

const seenUnknownFieldTypes = new Set<string>();
function labelForFieldType(value: string | null | undefined): string {
  if (!value) return 'other';
  const mapped = SOTR_FIELD_TYPE_LABELS[value];
  if (mapped) return mapped;
  if (!seenUnknownFieldTypes.has(value)) {
    seenUnknownFieldTypes.add(value);
    console.warn(
      `[signalsApi] Unmapped SOTR field_type "${value}" — falling back to "other". ` +
      `Add to SOTR_FIELD_TYPE_LABELS in src/lib/audit/signalsApi.ts.`,
    );
  }
  return 'other';
}

/**
 * In-memory group-and-sort. Returns themes descending by count, ties broken
 * by label asc for deterministic test output.
 */
function buildThemes(labels: Iterable<string>): SignalTheme[] {
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) =>
      b.count - a.count || a.label.localeCompare(b.label),
    );
}

// =============================================================================
// New theme-aware fetchers (PIQC v2). Both silent-degrade on error.
// =============================================================================

/**
 * Flagged questionnaire responses, themed by the question's section title.
 *
 * Joins questionnaire_response_objects → questionnaire_questions(section_title)
 * via PostgREST nested select. Pulls full rows (typically < 50 flagged per
 * audit) so we can group client-side; counts alone wouldn't carry themes.
 */
export async function fetchFlaggedResponsesSignal(
  auditId: string,
): Promise<FlaggedResponsesSignal> {
  const { data, error } = await supabase
    .from('questionnaire_response_objects')
    .select('id, questionnaire_questions!inner(section_title)')
    .eq('audit_id', auditId)
    .eq('inconsistency_flag', true);

  if (error) {
    console.error('[signalsApi] fetchFlaggedResponsesSignal error:', error);
    return EMPTY_FLAGGED;
  }
  const rows = (data ?? []) as Array<{
    questionnaire_questions: { section_title: string } | { section_title: string }[] | null;
  }>;

  // PostgREST may return the joined row as an array or a single object
  // depending on the version + relationship cardinality. Normalize both.
  const labels: string[] = [];
  for (const row of rows) {
    const q = row.questionnaire_questions;
    const section =
      Array.isArray(q) ? q[0]?.section_title :
      q?.section_title;
    if (section) labels.push(section);
  }

  return { count: rows.length, themes: buildThemes(labels) };
}

/**
 * Parsed-protocol items awaiting auditor review, themed by `field_type`.
 *
 * PIQC owns this fetch in its own lane rather than extending the shared
 * `countWorksheetItemsForStudy` helper in src/lib/sotr/ — two reasons:
 *   1. Keeps PIQC's signal pipeline self-contained for code review.
 *   2. The SOTR helper is also used by the SOTR drawer; PIQC's needs
 *      (themes, silent-degrade) differ from the drawer's (totals + throw
 *      on RLS denial). Forking is cheaper than coupling the two.
 *
 * If PIQC's count ever drifts from the SOTR drawer's count, the auditor
 * sees the disagreement on screen — a visible failure, not a silent one.
 */
export async function fetchSotrAwaitingReviewSignal(
  protocolId: string,
): Promise<SotrAwaitingReviewSignal> {
  const { data, error } = await supabase
    .from('protocol_extracted_items')
    .select('id, field_type, documents!inner(protocol_id)')
    .eq('documents.protocol_id', protocolId)
    .or('review_status.eq.draft,review_status.is.null');

  if (error) {
    console.error('[signalsApi] fetchSotrAwaitingReviewSignal error:', error);
    return EMPTY_SOTR;
  }
  const rows = (data ?? []) as Array<{ field_type: string | null }>;
  const labels = rows.map((r) => labelForFieldType(r.field_type));

  return { count: rows.length, themes: buildThemes(labels) };
}

// =============================================================================
// Back-compat: the v1 count-only helper.
//
// Retained because (a) other surfaces may import it later and (b) the
// existing test suite asserts its silent-degrade contract directly.
// The v2 fetcher above is what usePiqcSignals actually calls.
// =============================================================================

/**
 * Count of questionnaire responses where the auditor set inconsistency_flag=true.
 *
 * Returns 0 on any error (silent degradation; a missing signal is better
 * than a blocking error in the shoulder UX).
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
    console.error('[signalsApi] countQuestionnaireFlaggedResponses error:', error);
    return 0;
  }
  return count ?? 0;
}
