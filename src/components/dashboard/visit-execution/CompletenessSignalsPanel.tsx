import { useState } from 'react';
import { AlertCircle, Plus, X, Loader2, FileText } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type {
  VisitCompletenessSignal,
  VisitConfidenceState,
} from '../../../types/visit-execution';

// =============================================================================
// CompletenessSignalsPanel — Sprint 4c.
//
// Renders the list of pending visit_completeness_signals for the current
// visit and exposes two affordances per row:
//
//   - "Add as requirement"  → triggers onPromote(signal). Parent opens the
//                              RequirementTextDrawer in 'promote_signal' mode
//                              prefilled with signal.gap_text.
//
//   - "Dismiss"             → triggers onDismiss(signal). Immediate
//                              (no confirmation drawer): the audit log
//                              already captures the dismissal; coordinator
//                              can re-promote later from the drift log
//                              if needed (Sprint 4+ work).
//
// Style: blue/cool tone, NOT red. These are suggestions, not errors.
// PIQC's completeness pass found something the parser missed; coordinator
// is the deciding party. Per `feedback_collapse_cognitive_load.md` and
// `feedback_vew_cognitive_load_test.md` the panel stays expanded by default
// because pending signals are precisely the kind of "thing that needs your
// attention" that earns first-screen real estate.
//
// Pure presentation. Parent owns the loading + state machine; this component
// only knows about per-row in-flight (so we can show a spinner without
// re-rendering the whole panel).
// =============================================================================

interface Props {
  signals: VisitCompletenessSignal[];
  /** Set of signal IDs currently in-flight (parent owns the set). */
  inFlightSignalIds: Set<string>;
  onPromote: (signal: VisitCompletenessSignal) => void;
  onDismiss: (signal: VisitCompletenessSignal) => void;
}

function confidenceLabel(c: VisitConfidenceState): string {
  switch (c) {
    case 'high':         return 'High confidence';
    case 'medium':       return 'Medium confidence';
    case 'low':          return 'Low confidence';
    case 'needs_review': return 'Needs review';
  }
}

export default function CompletenessSignalsPanel({
  signals,
  inFlightSignalIds,
  onPromote,
  onDismiss,
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  // Show only top 3 by default; "Show all" toggles full list. Keeps the
  // first screen quiet when a protocol has 8+ flagged gaps for one visit.
  const [showAll, setShowAll] = useState(false);

  if (signals.length === 0) return null;

  const visible = showAll ? signals : signals.slice(0, 3);
  const hiddenCount = signals.length - visible.length;

  return (
    <section
      data-testid="vew-completeness-signals-panel"
      aria-label="PIQC-detected possibly-missing requirements"
      className={`rounded-2xl border p-4 space-y-3 ${
        isLight
          ? 'bg-blue-50/40 border-blue-200/60'
          : 'bg-blue-400/[0.04] border-blue-400/15'
      }`}
    >
      <header className="flex items-start gap-2.5">
        <div
          className={`mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 ${
            isLight ? 'bg-blue-100 text-blue-700' : 'bg-blue-400/15 text-blue-300'
          }`}
          aria-hidden
        >
          <AlertCircle size={12} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-fg-heading text-xs font-semibold leading-tight">
            {signals.length} possibly-missing requirement{signals.length === 1 ? '' : 's'}
          </p>
          <p className="text-fg-sub text-[11px] leading-relaxed mt-0.5">
            PIQC's completeness pass flagged the items below as protocol-mandated for this visit
            but not detected in the parsed checklist. Promote anything you agree should be on the
            list; dismiss the false positives.
          </p>
        </div>
      </header>

      <ul className="space-y-2" role="list">
        {visible.map((signal) => {
          const inFlight = inFlightSignalIds.has(signal.id);
          return (
            <li
              key={signal.id}
              data-testid="vew-signal-row"
              data-signal-id={signal.id}
              className={`rounded-lg border px-3 py-2.5 ${
                isLight
                  ? 'bg-white border-[#dde6f0]'
                  : 'bg-white/[0.02] border-white/[0.06]'
              } ${inFlight ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-fg-body text-sm leading-snug">
                    {signal.gap_text}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    <span
                      className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider rounded-md border px-1.5 py-0.5 ${
                        isLight
                          ? 'text-blue-700 bg-blue-50 border-blue-200'
                          : 'text-blue-400 bg-blue-400/10 border-blue-400/20'
                      }`}
                    >
                      {confidenceLabel(signal.detection_confidence)}
                    </span>

                    {(signal.source_section || signal.source_page) && (
                      <span className="inline-flex items-center gap-1 text-fg-muted text-[11px]">
                        <FileText size={10} aria-hidden />
                        {signal.source_section ?? 'Protocol body'}
                        {signal.source_page !== null && ` · p. ${signal.source_page}`}
                      </span>
                    )}

                    {signal.detection_reason && (
                      <span className="text-fg-muted text-[11px] italic">
                        “{signal.detection_reason}”
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Primary button styling matches RequirementTextDrawer's
                      Save button (the canonical primary style in VEW): dark
                      neutral in light theme, white in dark theme. Keeps the
                      whole namespace using one primary-button system. */}
                  <button
                    type="button"
                    onClick={() => onPromote(signal)}
                    disabled={inFlight}
                    data-testid="vew-signal-promote"
                    aria-label={`Add as requirement: ${signal.gap_text}`}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[28px] rounded-md text-[11px] font-semibold ${
                      inFlight
                        ? isLight
                          ? 'bg-[#cbd2db] text-white cursor-not-allowed'
                          : 'bg-white/10 text-fg-muted cursor-not-allowed'
                        : isLight
                        ? 'bg-[#1f2937] text-white hover:bg-[#111827]'
                        : 'bg-white text-[#0d1118] hover:bg-[#e5e7eb]'
                    }`}
                  >
                    {inFlight ? (
                      <Loader2 size={11} className="animate-spin" aria-hidden />
                    ) : (
                      <Plus size={11} aria-hidden />
                    )}
                    <span>Add</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(signal)}
                    disabled={inFlight}
                    data-testid="vew-signal-dismiss"
                    aria-label={`Dismiss as not real: ${signal.gap_text}`}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[28px] rounded-md text-[11px] font-medium ${
                      inFlight
                        ? 'opacity-50 cursor-not-allowed'
                        : isLight
                        ? 'text-fg-sub hover:bg-[#eef2f6]'
                        : 'text-fg-sub hover:bg-white/[0.06]'
                    }`}
                  >
                    <X size={11} aria-hidden />
                    <span>Dismiss</span>
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {hiddenCount > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          data-testid="vew-signals-show-all"
          className={`text-[11px] font-medium ${
            isLight ? 'text-blue-700 hover:text-blue-900' : 'text-blue-300 hover:text-blue-200'
          }`}
        >
          Show {hiddenCount} more
        </button>
      )}
    </section>
  );
}
