import { useEffect, useState, useCallback } from 'react';
import { fetchWorksheetItemSourceEvidence } from '../lib/sotr/sourceEvidenceApi';
import type { WorksheetItemSourceEvidence } from '../types/sotr';

// Fetches source evidence for a single worksheet item with loading/error
// state, and a manual retry. Triggers when (studyId, itemId) become defined
// and re-runs when either changes.

export type UseWorksheetItemEvidence =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: WorksheetItemSourceEvidence }
  | { status: 'error'; message: string };

export function useWorksheetItemEvidence(
  studyId: string | null,
  worksheetItemId: string | null,
): UseWorksheetItemEvidence & { retry: () => void; refresh: () => void } {
  const [state, setState] = useState<UseWorksheetItemEvidence>({ status: 'idle' });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!studyId || !worksheetItemId) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });

    fetchWorksheetItemSourceEvidence(studyId, worksheetItemId)
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'success', data });
      })
      .catch((err) => {
        if (cancelled) return;
        // Friendly default; technical message kept off-screen.
        const message =
          err instanceof Error && err.message
            ? 'We could not load source evidence for this item.'
            : 'We could not load source evidence for this item.';
        // eslint-disable-next-line no-console
        console.warn('[sotr] worksheet item evidence fetch failed', {
          studyId,
          worksheetItemId,
          // Log only the error name/code — never the response body.
          errorName: err instanceof Error ? err.name : 'unknown',
        });
        setState({ status: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [studyId, worksheetItemId, retryToken]);

  const retry = useCallback(() => setRetryToken((n) => n + 1), []);
  // refresh() re-fetches without showing the loading spinner (silent
  // re-sync used after a review action completes).
  const refresh = retry;
  return { ...state, retry, refresh };
}
