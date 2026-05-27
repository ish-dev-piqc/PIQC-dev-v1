import { useState } from 'react';
import { Download, Loader2, Check, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { downloadVisitWorksheet } from '../../../lib/visit-execution/visitExecutionExportApi';

// =============================================================================
// ExportWorksheetButton — Sprint 5.
//
// Replaces ExportPlaceholderButton with a real PDF download. Label is
// "Export worksheet" deliberately — Sprint 5 is where the "worksheet" noun
// first surfaces in the UI per product_vew_workspace_vs_worksheet_model.md
// (workspace = acting surface; worksheet = deliverable).
//
// State machine:
//   idle    → ready to click
//   loading → RPC in flight + PDF building + browser save() — disabled
//   success → "Exported ✓" for ~2 seconds, then auto-reverts to idle
//   error   → "Couldn't export — try again" tooltip; click again to retry
//
// No optimistic UI here — the download is a one-shot moment; the user
// should see the truth (loading → success or error) before deciding what
// to do next. Mirrors Sprint 4b's "no optimistic update for text edits"
// principle: high-stakes moments don't get prematurely-confirmed UX.
// =============================================================================

interface Props {
  visitTemplateId: string;
  /** Visit name for screen-reader context only; the filename comes from
   *  the RPC's server-stamped packet, not from this prop. */
  visitName: string;
}

type ButtonState = 'idle' | 'loading' | 'success' | 'error';

const SUCCESS_RESET_MS = 2000;

export default function ExportWorksheetButton({ visitTemplateId, visitName }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [state, setState] = useState<ButtonState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleClick() {
    if (state === 'loading') return; // dedupe rapid double-clicks

    setState('loading');
    setErrorMessage(null);

    const result = await downloadVisitWorksheet(visitTemplateId);

    if (!result.ok) {
      console.error('[vew] export_failed', {
        visitTemplateId,
        error: result.error,
      });
      setErrorMessage(result.error);
      setState('error');
      return;
    }

    setState('success');
    // Auto-revert to idle so a coordinator can re-export (e.g. after
    // making another edit). Window timeout is fine since this component
    // is small and the state isn't structural.
    window.setTimeout(() => {
      setState('idle');
    }, SUCCESS_RESET_MS);
  }

  // Per polish-v2: align with the canonical primary-button style used by
  // RequirementTextDrawer's save button. The button is enabled-and-actionable
  // in idle/success/error; loading is the only disabled state.
  const isDisabled = state === 'loading';

  const baseClass = `inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors`;
  const enabledClass = isLight
    ? 'bg-[#1f2937] text-white hover:bg-[#111827]'
    : 'bg-white text-[#0d1118] hover:bg-[#e5e7eb]';
  const disabledClass = isLight
    ? 'bg-[#cbd2db] text-white cursor-wait'
    : 'bg-white/10 text-fg-muted cursor-wait';

  const iconForState = (() => {
    switch (state) {
      case 'loading': return <Loader2 size={12} className="animate-spin" aria-hidden />;
      case 'success': return <Check size={12} aria-hidden />;
      case 'error':   return <AlertTriangle size={12} aria-hidden />;
      case 'idle':
      default:        return <Download size={12} aria-hidden />;
    }
  })();

  const labelForState = (() => {
    switch (state) {
      case 'loading': return 'Exporting…';
      case 'success': return 'Exported ✓';
      case 'error':   return 'Try again';
      case 'idle':
      default:        return 'Export worksheet';
    }
  })();

  return (
    <div className="inline-block group relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        aria-label={`Export worksheet for ${visitName} as PDF`}
        data-testid="vew-export-worksheet"
        data-state={state}
        className={`${baseClass} ${isDisabled ? disabledClass : enabledClass}`}
      >
        {iconForState}
        {labelForState}
      </button>

      {state === 'error' && errorMessage && (
        <span
          role="tooltip"
          data-testid="vew-export-worksheet-error"
          className={`pointer-events-none absolute right-0 top-full mt-2 w-72 text-[11px] leading-relaxed px-3 py-2 rounded-md border shadow-lg z-20 ${
            isLight
              ? 'bg-[#fdecec] border-[#f3c7c7] text-[#742a2a]'
              : 'bg-[#3b1f1f] border-[#5a2e2e] text-[#f5b8b8]'
          }`}
        >
          Couldn't export the worksheet: {errorMessage}. Try again or refresh the page.
        </span>
      )}

      {state === 'idle' && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute right-0 top-full mt-2 w-72 text-[11px] leading-relaxed px-3 py-2 rounded-md border shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 z-20 ${
            isLight
              ? 'bg-white border-[#e2e8ee] text-[#374152]'
              : 'bg-[#131a22] border-white/10 text-[#d2d7e0]'
          }`}
        >
          PIQC-drafted worksheet (PDF). Final accuracy + compliance verification
          happens outside PIQC.
        </span>
      )}
    </div>
  );
}
