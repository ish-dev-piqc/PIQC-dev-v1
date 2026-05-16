import { useEffect, useState } from 'react';
import { countQuestionnaireFlaggedResponses } from '../lib/audit/signalsApi';
import { countWorksheetItemsForStudy } from '../lib/sotr/sourceEvidenceApi';

// =============================================================================
// usePiqcSignals — aggregates ambient attention cues for the active audit.
//
// PIQC's dock renders a subtle dot when this hook reports any non-empty
// signal. The panel's empty state surfaces the named signals when opened.
// The hook intentionally does NOT trigger toasts, modals, or any auto-action;
// the founder vision is on-shoulder presence, not interruption.
//
// Two signals in v1 — see signalsApi.ts header for the rationale + the
// deferred-signal backlog. Adding a third signal later means:
//   1. Add a fetch
//   2. Add a case to the `signals` accumulator below
//   3. Map the new kind in the panel's renderer
// No other surfaces need to change. The kind/label/action shape is the
// extension point.
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
}

interface State {
  signals: PiqcSignal[];
  loading: boolean;
}

const EMPTY_STATE: State = { signals: [], loading: false };

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

    // Parallel fetches — both are RLS-gated and either may RLS-deny without
    // affecting the other. Promise.allSettled so one failure doesn't void
    // the other signal.
    const sotrP = protocolId
      ? countWorksheetItemsForStudy(protocolId)
      : Promise.resolve({ total: 0, awaitingReview: 0 });
    const flagP = countQuestionnaireFlaggedResponses(auditId);

    Promise.allSettled([sotrP, flagP]).then(([sotrRes, flagRes]) => {
      if (cancelled) return;

      const signals: PiqcSignal[] = [];

      if (sotrRes.status === 'fulfilled' && sotrRes.value.awaitingReview > 0) {
        const n = sotrRes.value.awaitingReview;
        signals.push({
          kind:  'sotr_awaiting_review',
          count: n,
          label: `${n} parsed protocol item${n === 1 ? '' : 's'} awaiting your review`,
        });
      } else if (sotrRes.status === 'rejected') {
        // Silent degrade — RLS denial on a cross-user protocol is a real
        // path. We don't want PIQC to throw a dot for "I couldn't read."
        console.warn('[piqc-signals] SOTR fetch failed', sotrRes.reason);
      }

      if (flagRes.status === 'fulfilled' && flagRes.value > 0) {
        const n = flagRes.value;
        signals.push({
          kind:  'questionnaire_flagged',
          count: n,
          label: `${n} questionnaire response${n === 1 ? '' : 's'} you flagged as inconsistent`,
        });
      } else if (flagRes.status === 'rejected') {
        console.warn('[piqc-signals] questionnaire-flag fetch failed', flagRes.reason);
      }

      setState({ signals, loading: false });
    });

    return () => {
      cancelled = true;
    };
  }, [auditId, protocolId, bumpToken]);

  return state;
}
