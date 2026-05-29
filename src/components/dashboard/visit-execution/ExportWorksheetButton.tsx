import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Check, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { downloadVisitWorksheet } from '../../../lib/visit-execution/visitExecutionExportApi';
import { ROLE_LABELS, type RoleFilter } from '../../../types/visit-execution';

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
  /**
   * Sprint 6: active role-filter lens. `'all'` is the canonical full-visit
   * export. A specific role narrows the export to role-relevant items;
   * filename gets a `<role>` segment; PDF header gets a "Filtered view:
   * <Role>" subtitle. Defaults to `'all'` for backward compatibility.
   */
  roleFilter?: RoleFilter;
  /**
   * Sprint 6: number of items visible under the active role filter. When
   * `roleFilter !== 'all'` AND `filteredCount === 0`, the export button
   * is disabled — clicking would produce an empty-checklist deliverable
   * that's never useful. Tooltip explains the empty state.
   *
   * Optional: if omitted, the empty-for-role guard never triggers (so
   * pre-Sprint-6 callers without role-awareness keep their always-enabled
   * behavior). The guard naturally short-circuits because `undefined === 0`
   * is false — no sentinel value needed.
   */
  filteredCount?: number;
}

type ButtonState = 'idle' | 'loading' | 'success' | 'error';

const SUCCESS_RESET_MS = 2000;

export default function ExportWorksheetButton({
  visitTemplateId,
  visitName,
  roleFilter = 'all',
  filteredCount,
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [state, setState] = useState<ButtonState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Track the success-revert timeout so we can clear it on unmount or on
  // a new click — prevents setState firing on an unmounted component when
  // the coordinator switches visits mid-success-window.
  const revertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revertTimeoutRef.current !== null) {
        clearTimeout(revertTimeoutRef.current);
        revertTimeoutRef.current = null;
      }
    };
  }, []);

  async function handleClick() {
    if (state === 'loading') return; // dedupe rapid double-clicks

    // Clear any pending revert from a previous success — a coordinator may
    // click Export again before the 2s window finishes.
    if (revertTimeoutRef.current !== null) {
      clearTimeout(revertTimeoutRef.current);
      revertTimeoutRef.current = null;
    }

    setState('loading');
    setErrorMessage(null);

    const result = await downloadVisitWorksheet(visitTemplateId, {}, roleFilter);

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
    // making another edit). Timeout tracked in revertTimeoutRef so we
    // can clear it on unmount / next click.
    revertTimeoutRef.current = setTimeout(() => {
      revertTimeoutRef.current = null;
      setState('idle');
    }, SUCCESS_RESET_MS);
  }

  // Sprint 6: also disable when the active role filter yields zero items.
  // An empty-deliverable PDF is never useful — coordinator would have to
  // switch filter + retry anyway. Disable surfaces the dead-end early
  // rather than producing filesystem clutter.
  const isEmptyForRole = roleFilter !== 'all' && filteredCount === 0;
  const isDisabled = state === 'loading' || isEmptyForRole;

  const baseClass = `inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors`;
  const enabledClass = isLight
    ? 'bg-[#1E293B] text-white hover:bg-[#0F172A]'
    : 'bg-white text-[#020617] hover:bg-[#E2E8F0]';
  // Cursor differs by disabled reason: `cursor-wait` for loading (work
  // in progress), `cursor-not-allowed` for empty-for-role (can't proceed
  // until the user changes filter).
  const disabledCursor = state === 'loading' ? 'cursor-wait' : 'cursor-not-allowed';
  const disabledClass = isLight
    ? `bg-[#CBD5E1] text-white ${disabledCursor}`
    : `bg-white/10 text-fg-muted ${disabledCursor}`;

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
      // "Export failed" rather than "Try again" — design-critique caught
      // that AlertTriangle + "Try again" mixed metaphors (alert icon paired
      // with positive action). The button stays clickable in this state;
      // the click action IS the retry. Tooltip below carries detail.
      case 'error':   return 'Export failed';
      case 'idle':
      default:
        // Sprint 6: surface the active role lens in the button label so a
        // coordinator can't accidentally export a filtered slice thinking
        // it's the full visit. "All" → canonical "Export worksheet";
        // any specific role → "Export <Role> worksheet".
        return roleFilter === 'all'
          ? 'Export worksheet'
          : `Export ${ROLE_LABELS[roleFilter]} worksheet`;
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
              ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#881337]'
              : 'bg-[#4C0519] border-[#881337] text-[#FECDD3]'
          }`}
        >
          Couldn't export the worksheet: {errorMessage}. Try again or refresh the page.
        </span>
      )}

      {state === 'idle' && !isEmptyForRole && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute right-0 top-full mt-2 w-72 text-[11px] leading-relaxed px-3 py-2 rounded-md border shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 z-20 ${
            isLight
              ? 'bg-white border-[#E2E8F0] text-[#334155]'
              : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]'
          }`}
        >
          PIQC-drafted worksheet (PDF). Final accuracy + compliance verification
          happens outside PIQC.
        </span>
      )}

      {/* Sprint 6: empty-for-role tooltip. Surfaces WHY the button is
          disabled so the coordinator doesn't think the export is broken —
          they just need to widen their filter. Always-visible (not
          group-hover) so the explanation is immediate when the disabled
          state appears. */}
      {isEmptyForRole && (
        <span
          role="tooltip"
          data-testid="vew-export-worksheet-empty-for-role"
          className={`pointer-events-none absolute right-0 top-full mt-2 w-72 text-[11px] leading-relaxed px-3 py-2 rounded-md border shadow-lg z-20 ${
            isLight
              ? 'bg-white border-[#E2E8F0] text-[#334155]'
              : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]'
          }`}
        >
          No requirements in the <span className="font-semibold">{ROLE_LABELS[roleFilter as Exclude<RoleFilter, 'all'>]}</span> view
          for this visit. Switch to <span className="font-semibold">All</span> or a different
          role to export.
        </span>
      )}
    </div>
  );
}
