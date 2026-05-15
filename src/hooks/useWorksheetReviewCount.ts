import { useEffect, useState } from 'react';
import {
  countWorksheetItemsForStudy,
  type WorksheetReviewCount,
} from '../lib/sotr/sourceEvidenceApi';

// =============================================================================
// useWorksheetReviewCount — totals + awaiting-review queue size for a study.
//
// Used by Audit Mode's workspace shell to badge the "Protocol source" button
// with the number of parsed items still awaiting auditor review. Lives next
// to useWorksheetItemEvidence so all SOTR-side hooks are in one place.
//
// `bumpToken` lets a parent invalidate the cached count (e.g. after the
// drawer closes and the auditor has reviewed items). Increment the token to
// force a refetch without remounting the host.
//
// On error the hook returns null — callers should hide the badge rather than
// show a broken count. RLS denials on cross-user documents are a real path
// (a Site-Mode-uploaded protocol surfaced into an Audit Mode session) and we
// don't want a red banner from a permission-denied response.
// =============================================================================

interface State {
  data: WorksheetReviewCount | null;
  loading: boolean;
}

export function useWorksheetReviewCount(
  studyId: string | null | undefined,
  bumpToken: number = 0,
): State {
  const [state, setState] = useState<State>({ data: null, loading: !!studyId });

  useEffect(() => {
    if (!studyId) {
      setState({ data: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ data: prev.data, loading: true }));
    countWorksheetItemsForStudy(studyId)
      .then((count) => {
        if (cancelled) return;
        setState({ data: count, loading: false });
      })
      .catch(() => {
        if (cancelled) return;
        // Swallow — see header comment. Hiding the badge is the safe default.
        setState({ data: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [studyId, bumpToken]);

  return state;
}
