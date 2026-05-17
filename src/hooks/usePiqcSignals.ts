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
  if (!top || top.count < 2)            return undefined;
  if (top.count / total < 0.5)          return undefined;
  if (top.count === total)              return `all about ${top.label}`;
  return `${top.count} about ${top.label}`;
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
        });
      }

      if (flag.count > 0) {
        const n = flag.count;
        signals.push({
          kind:      'questionnaire_flagged',
          count:     n,
          label:     `${n} questionnaire response${n === 1 ? '' : 's'} you flagged as inconsistent`,
          themeHint: buildThemeHint(n, flag.themes),
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
