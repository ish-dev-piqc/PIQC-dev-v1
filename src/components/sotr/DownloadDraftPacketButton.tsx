import { useState } from 'react';
import { Download, Loader2, AlertTriangle } from 'lucide-react';
import { downloadDraftConfidencePacket } from '../../lib/sotr/exportApi';

// =============================================================================
// DownloadDraftPacketButton — frontend trigger for the CSV export (PR-6).
//
// Sits in the worksheet review header. On click → fetch packet → build CSV →
// trigger Blob download. Loading state shows spinner; failure shows a
// friendly inline message — no raw error leaks to the user.
//
// PIQC is a draft review aid only. Button label uses draft-review language.
// =============================================================================

interface Props {
  studyId: string;
  studyCode?: string | null;
}

type State =
  | { kind: 'idle' }
  | { kind: 'downloading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; rowCount: number };

export default function DownloadDraftPacketButton({ studyId, studyCode }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function handleClick() {
    setState({ kind: 'downloading' });
    try {
      const result = await downloadDraftConfidencePacket(studyId, studyCode ?? null);
      setState({ kind: 'success', rowCount: result.rowCount });
    } catch {
      setState({
        kind: 'error',
        message: 'We could not generate the draft packet right now. Please try again.',
      });
    }
  }

  return (
    <div data-testid="sotr-download-draft-packet" className="space-y-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={state.kind === 'downloading'}
        data-testid="sotr-download-draft-packet-button"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border bg-white dark:bg-[#0F172A] border-[#E2E8F0] dark:border-white/10 text-fg-body hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] disabled:opacity-50"
      >
        {state.kind === 'downloading' ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <Download size={11} />
        )}
        {state.kind === 'downloading' ? 'Preparing…' : 'Download Draft Confidence Packet'}
      </button>

      {state.kind === 'error' && (
        <div
          data-testid="sotr-download-draft-packet-error"
          role="alert"
          className="flex items-start gap-1.5 text-[11px] text-rose-700 dark:text-rose-300 leading-relaxed"
        >
          <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
          <span>{state.message}</span>
        </div>
      )}

      {state.kind === 'success' && (
        <p
          data-testid="sotr-download-draft-packet-success"
          className="text-[11px] text-fg-sub"
        >
          Draft packet downloaded ({state.rowCount} {state.rowCount === 1 ? 'row' : 'rows'}).
        </p>
      )}
    </div>
  );
}
