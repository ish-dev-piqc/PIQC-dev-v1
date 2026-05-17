import { useEffect, useState } from 'react';
import {
  fetchFlaggedResponsesSignal,
  fetchSotrAwaitingReviewSignal,
  type SignalTheme,
} from '../lib/audit/signalsApi';

// =============================================================================
// usePiqcSignals — aggregates ambient attention cues for the active audit.
//
// PIQC's dock renders a subtle dot when this hook reports any non-empty
// signal. The panel's empty state surfaces the named signals when opened.
// The hook intentionally does NOT trigger toasts, modals, or any auto-action;
// the founder vision is on-shoulder presence, not interruption.
//
// v1 (PR #76) shipped raw counts. v2 (this file) adds `themeHint` — a
// one-line clustering of the underlying rows by the most common field
// value (SOTR field_type / questionnaire section_title). The hint makes
// PIQC read as "noticed a pattern" rather than "knows arithmetic." See
// signalsApi.ts header for the doctrine rationale.
//
// Refetches when auditId or protocolId change. `bumpToken` invalidates the
// cache (parent increments it after the auditor closes a drawer where they
// might have resolved a flagged response or reviewed SOTR items).
// =============================================================================

export type PiqcSignalKind = 'sotr_awaiting_review' | 'questionnaire_flagged';

export interface PiqcSignal {
  kind:   PiqcSignalKind;
  count:  number;
  /** Human-readable one-liner for the panel's empty-state surface. */
  label:  string;
  /**
   * Optional thematic hint when one cluster dominates the signal. See
   * `buildThemeHint` for the rules. Absent when no theme is decisive —
   * we'd rather say nothing than say something noisy.
   */
  themeHint?: string;
  /**
   * The dominant cluster, structured. Present iff `themeHint` is present
   * (same threshold gate). Lets downstream surfaces (chat-prompt
   * pre-seed in PR #82) reference the label/count without re-parsing
   * the display string.
   */
  topTheme?: SignalTheme;
}

interface State {
  signals: PiqcSignal[];
  loading: boolean;
}

const EMPTY_STATE: State = { signals: [], loading: false };

// -----------------------------------------------------------------------------
// Theme-hint thresholds.
//
// Goal: hint only when one cluster genuinely dominates. The reading
// auditor should never look at a hint and think "that's not what's
// actually in there." False positives erode trust faster than missing
// hints erode usefulness.
//
//   - Skip when total <= 1     (clusters of 1 aren't insights)
//   - Skip when top cluster < 2 items
//   - Skip when top cluster < 50% of total (no clear dominance)
//   - "all about X" when top cluster == total
//   - "N about X"   otherwise
//
// These thresholds are deliberate; tweaking them changes how chatty
// PIQC gets. Update the test suite in lockstep.
// -----------------------------------------------------------------------------
export function buildThemeHint(
  total:  number,
  themes: SignalTheme[],
): string | undefined {
  if (total <= 1) return undefined;
  const top = themes[0];
  if (!top || top.count < 2) return undefined;
  // Defensive invariant: a fetcher should never report a cluster larger
  // than the total, but if it ever does (refactor regression, partial
  // pagination, etc.) clamp instead of producing a >100% share. Wrong-
  // looking copy is worse than missing copy.
  const topCount = Math.min(top.count, total);
  if (topCount / total < 0.5) return undefined;
  if (topCount === total)     return `— all are about ${top.label}`;
  return `— ${topCount} are about ${top.label}`;
}

/**
 * Returns the dominant cluster (label + clamped count) when it qualifies
 * for a hint, otherwise undefined. Same threshold pipeline as
 * `buildThemeHint` so the two surfaces — display string + structured
 * data — can never disagree about whether a theme exists.
 *
 * Lives next to `buildThemeHint` so future threshold changes have to
 * update both in lockstep. Tests assert the lockstep.
 */
export function buildClusterTopTheme(
  total:  number,
  themes: SignalTheme[],
): SignalTheme | undefined {
  if (buildThemeHint(total, themes) === undefined) return undefined;
  const top = themes[0]!;
  return { label: top.label, count: Math.min(top.count, total) };
}

/**
 * Auditor-voiced prompt seeded into the chat composer when the auditor
 * clicks "Ask about these →" on a clustered signal. The seed is a
 * DRAFT — it sits in the input field; the auditor reads, edits if
 * desired, and clicks Send. Two human checkpoints (click + Send)
 * preserve the no-silent-write doctrine.
 *
 * Voice: this is the AUDITOR speaking to PIQC, not PIQC speaking to the
 * auditor. First-person from the auditor's perspective ("my review",
 * "I flagged"). Concise; the auditor can always rewrite.
 *
 * Returns undefined for unknown signal kinds or signals without a
 * topTheme — the caller (panel) gates the button on a defined return.
 */
export function buildClusterPrompt(signal: PiqcSignal): string | undefined {
  const top = signal.topTheme;
  if (!top) return undefined;

  const isAll       = top.count === signal.count;
  const countPhrase = isAll ? '' : ` ${top.count}`;

  switch (signal.kind) {
    case 'sotr_awaiting_review':
      // SOTR theme labels are short noun phrases ("visit schedule",
      // "eligibility criteria") so they compose cleanly into "items".
      return `Tell me about the${countPhrase} ${top.label} items awaiting my review.`;
    case 'questionnaire_flagged':
      // section_title is free-form template metadata. Auditor can
      // re-word in the composer if it reads off for their template.
      return `What's inconsistent about the${countPhrase} ${top.label} responses I flagged?`;
    default:
      return undefined;
  }
}

export function usePiqcSignals(
  auditId:    string | null | undefined,
  protocolId: string | null | undefined,
  bumpToken:  number = 0,
): State {
  const [state, setState] = useState<State>(EMPTY_STATE);

  useEffect(() => {
    if (!auditId) {
      setState(EMPTY_STATE);
      return;
    }
    let cancelled = false;
    setState({ signals: [], loading: true });

    // Both fetchers silent-degrade on error (return { count: 0, themes: [] }).
    // Using Promise.all is safe — neither side throws — and reads cleaner
    // than allSettled now that the asymmetric error contract from v1 is
    // gone. PIQC owns both fetch paths in src/lib/audit/signalsApi.ts.
    const sotrP = protocolId
      ? fetchSotrAwaitingReviewSignal(protocolId)
      : Promise.resolve({ count: 0, themes: [] });
    const flagP = fetchFlaggedResponsesSignal(auditId);

    Promise.all([sotrP, flagP]).then(([sotr, flag]) => {
      if (cancelled) return;

      const signals: PiqcSignal[] = [];

      if (sotr.count > 0) {
        const n = sotr.count;
        signals.push({
          kind:      'sotr_awaiting_review',
          count:     n,
          label:     `${n} parsed protocol item${n === 1 ? '' : 's'} awaiting your review`,
          themeHint: buildThemeHint(n, sotr.themes),
          topTheme:  buildClusterTopTheme(n, sotr.themes),
        });
      }

      if (flag.count > 0) {
        const n = flag.count;
        signals.push({
          kind:      'questionnaire_flagged',
          count:     n,
          label:     `${n} questionnaire response${n === 1 ? '' : 's'} you flagged as inconsistent`,
          themeHint: buildThemeHint(n, flag.themes),
          topTheme:  buildClusterTopTheme(n, flag.themes),
        });
      }

      setState({ signals, loading: false });
    });

    return () => {
      cancelled = true;
    };
  }, [auditId, protocolId, bumpToken]);

  return state;
}
