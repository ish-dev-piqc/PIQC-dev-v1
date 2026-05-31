// =============================================================================
// deriveVisitConfidence — Sprint 7.
//
// Visit-level confidence rollup. Trusts server-stamped snapshot.confidence_state
// when present; otherwise derives a pessimistic "weakest link" rollup from
// the item-level confidence_states + presence of pending completeness signals.
//
// Why client-side derivation: per Sprint 4 decision-debt #2,
// `protocol_visit_templates.confidence_state` is always NULL on first ingest
// (the LLM passes don't emit visit-level confidence yet). Until that backend
// gap is closed (Sprint 7.5+), the workspace needs to surface SOMETHING the
// coordinator can triage on. The derivation is the bridge.
//
// Pessimistic rule (safety default — PIQC under-claims rather than over-claims):
//
//   ╔════════════════════════════════════════════════════════════════════════╗
//   ║  IF snapshot.confidence_state is populated → use it (server source).   ║
//   ║                                                                        ║
//   ║  ELSE iterate items + signals:                                         ║
//   ║    - ANY item with confidence_state='needs_review' → 'needs_review'    ║
//   ║    - ELSE ANY item with confidence_state='low'     → 'low'             ║
//   ║    - ELSE pending completeness_signal_count > 0    → 'medium'          ║
//   ║      (gaps suggest moderate confidence)                                ║
//   ║    - ELSE ANY item with confidence_state='medium'  → 'medium'          ║
//   ║    - ELSE ALL items null (never confidence-checked) → 'needs_review'   ║
//   ║    - ELSE (≥1 real 'high', rest high/null, no sigs) → 'high'           ║
//   ║                                                                        ║
//   ║  EMPTY items list (legacy / mock / parser-gap)     → 'needs_review'    ║
//   ╚════════════════════════════════════════════════════════════════════════╝
//
// Sprint 6 interplay: the helper takes already-filtered `items` as input, so
// when a role filter is active the derived confidence reflects that role's
// view. Keeps the helper pure and the caller in control of scope.
// =============================================================================

import type {
  VisitConfidenceState,
  VisitExecutionItem,
  VisitSnapshot,
} from '../../types/visit-execution';

/**
 * Derive the visit-level confidence rollup for display purposes.
 *
 * Inputs:
 *   - `snapshot` — the visit snapshot; if `snapshot.confidence_state` is
 *                  non-null, that wins (server source of truth).
 *   - `items`   — the items to consider. Pass the role-filtered set when
 *                  a Sprint 6 role lens is active; pass all items otherwise.
 *
 * Returns: a `VisitConfidenceState` suitable for badge / dot / chip render.
 *
 * Pure — same inputs always give the same output. Used by:
 *   - `VisitConfidenceBadge` (Sprint 7) — chips on snapshot card + nav dot
 *   - `ExecutionChecklist` (Sprint 7) — per-item chip uses item.confidence_state
 *                                       directly, NOT this rollup
 *   - `buildVisitWorksheetPdf` (Sprint 7) — PDF title block + per-item column
 */
export function deriveVisitConfidence(
  snapshot: Pick<VisitSnapshot, 'confidence_state' | 'completeness_signal_count'>,
  items: ReadonlyArray<Pick<VisitExecutionItem, 'confidence_state'>>,
): VisitConfidenceState {
  // 1. Trust server-stamped visit-level confidence when present.
  if (snapshot.confidence_state) {
    return snapshot.confidence_state;
  }

  // 2. Empty items → no signal to derive from. Defaults to 'needs_review'
  //    (forces the coordinator to verify rather than assume).
  if (items.length === 0) {
    return 'needs_review';
  }

  // 3. Pessimistic "weakest link" scan. Tracks the lowest-confidence flag
  //    seen; later checks override earlier ones in severity order. Also tracks
  //    whether ANY item carried a real (non-null) confidence — a visit whose
  //    items are all null was never confidence-checked, so it has no basis to
  //    claim 'high'.
  let sawLow = false;
  let sawMedium = false;
  let sawAnyConfidence = false;
  for (const item of items) {
    const c = item.confidence_state;
    if (c === 'needs_review') {
      // Worst case — short-circuit immediately.
      return 'needs_review';
    }
    if (c === 'low') {
      sawLow = true;
      sawAnyConfidence = true;
    } else if (c === 'medium') {
      sawMedium = true;
      sawAnyConfidence = true;
    } else if (c === 'high') {
      sawAnyConfidence = true;
    }
    // null doesn't degrade the rollup, but it also doesn't earn 'high'.
  }

  if (sawLow) return 'low';

  // 4. Pending completeness signals demote a would-be 'high' to 'medium'.
  //    Rationale: PIQC found gaps it couldn't auto-resolve; the visit
  //    deserves human review even if every extracted item came in 'high'.
  if ((snapshot.completeness_signal_count ?? 0) > 0) {
    return 'medium';
  }

  if (sawMedium) return 'medium';

  // 5. No server stamp, no completeness signals, and not a single item carried
  //    a real confidence value → the visit was never confidence-checked.
  //    Be honest (needs_review) rather than claiming a false 'high'. Matched
  //    RPC visits hit step 1 (server-stamped) so this only catches truly
  //    unscored visits (legacy / parser-gap / unmatched).
  if (!sawAnyConfidence) {
    return 'needs_review';
  }

  return 'high';
}

/**
 * Display labels for the confidence states. Mirrors the SOTR labels but
 * kept VEW-local per mode-isolation rule (no cross-mode imports).
 */
export const CONFIDENCE_LABELS: Record<VisitConfidenceState, string> = {
  high:         'High confidence',
  medium:       'Medium confidence',
  low:          'Low confidence',
  needs_review: 'Needs review',
};

/**
 * Short labels for tight cells (the export PDF's per-item column, navigator
 * dot tooltips). Uppercased to match the workspace's existing chip vocabulary.
 */
export const CONFIDENCE_SHORT_LABELS: Record<VisitConfidenceState, string> = {
  high:         'High',
  medium:       'Medium',
  low:          'Low',
  needs_review: 'Review',
};

/**
 * One-sentence tooltip text per confidence state. Surfaces in
 * VisitConfidenceBadge's hover tooltip — earns trust by being explicit
 * about what the confidence actually means.
 */
export const CONFIDENCE_TOOLTIPS: Record<VisitConfidenceState, string> = {
  high:
    "PIQC is highly confident in this visit's extracted requirements. Review them as you would a clean draft.",
  medium:
    'Moderate confidence — review carefully before relying on this draft. PIQC may have missed nuance.',
  low:
    "Low confidence in this visit's extraction. Review against the protocol section directly and edit liberally.",
  needs_review:
    "PIQC couldn't establish confidence on this visit. Open the protocol section, refine in the workspace, then trust your version.",
};
