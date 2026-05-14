import { useState } from 'react';
import { ExternalLink, FileX2, Loader2 } from 'lucide-react';
import {
  fetchProtocolPdfUrl,
  ProtocolPdfNotRetainedError,
  ProtocolPdfAccessDeniedError,
} from '../../lib/sotr/protocolPdfApi';

// =============================================================================
// ViewCitedPageButton — opens the protocol PDF in a new tab (PR-4 foundation).
//
// PR-5 will replace the new-tab open with an embedded viewer + page jump +
// highlight overlay. For now this just confirms the secure-URL flow works
// end to end and gives users a way to reach the cited page in their browser.
//
// On click:
//   - calls fetchProtocolPdfUrl (RPC → storage sign)
//   - opens the signed URL in a new tab with noopener/noreferrer
//   - never logs the URL itself
//
// Error states:
//   - ProtocolPdfNotRetainedError → "No PDF stored for this document."
//   - ProtocolPdfAccessDeniedError → "You don't have access to this document."
//   - any other error → "We couldn't open the protocol PDF right now."
// =============================================================================

interface Props {
  studyId: string;
  documentId: string;
  /** Optional override for the new-tab opener (used by tests). */
  opener?: (url: string) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string };

const NOT_RETAINED_MSG    = 'No PDF stored for this document. Re-upload the protocol to enable cited-page viewing.';
const ACCESS_DENIED_MSG   = 'You do not have access to this document.';
const GENERIC_FAILURE_MSG = 'We could not open the protocol PDF right now. Please try again.';

function defaultOpener(url: string): void {
  // noopener + noreferrer prevents the opened tab from accessing window.opener.
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function ViewCitedPageButton({ studyId, documentId, opener = defaultOpener }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function handleClick() {
    setState({ kind: 'loading' });
    try {
      const { url } = await fetchProtocolPdfUrl(studyId, documentId);
      opener(url);
      setState({ kind: 'idle' });
    } catch (err) {
      let message = GENERIC_FAILURE_MSG;
      if (err instanceof ProtocolPdfNotRetainedError)  message = NOT_RETAINED_MSG;
      if (err instanceof ProtocolPdfAccessDeniedError) message = ACCESS_DENIED_MSG;
      setState({ kind: 'error', message });
    }
  }

  return (
    <div data-testid="sotr-view-cited-page" className="space-y-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={state.kind === 'loading'}
        data-testid="sotr-view-cited-page-button"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border bg-white dark:bg-[#131a22] border-[#e2e8ee] dark:border-white/10 text-fg-body hover:bg-[#f5f7fa] dark:hover:bg-white/[0.04] disabled:opacity-50"
      >
        {state.kind === 'loading' ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <ExternalLink size={11} />
        )}
        {state.kind === 'loading' ? 'Opening…' : 'View cited page in protocol'}
      </button>

      {state.kind === 'error' && (
        <div
          data-testid="sotr-view-cited-page-error"
          role="alert"
          className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed"
        >
          <FileX2 size={11} className="flex-shrink-0 mt-0.5" />
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}
