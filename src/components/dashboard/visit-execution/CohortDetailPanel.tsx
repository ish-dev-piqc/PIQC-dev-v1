import { FlaskConical, FileText, AlertCircle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { ProtocolCohort } from '../../../types/visit-execution';

// =============================================================================
// CohortDetailPanel — Slice 3 (cohort extraction).
//
// Shown in the right pane when a specific cohort is selected in the navigator's
// CohortFilterBar. Surfaces the per-cohort DOSE / regimen + description from the
// authoritative protocol_cohorts list (extracted from the protocol body — the
// same prose the Ask tab reads), so a coordinator filtering to "S3" sees what
// makes S3 distinct (its dose) alongside the shared visit schedule.
//
// Evidence indicator: a cohort with a source page shows "p. N"; one with no
// citation shows a muted "source citation pending" — the evidence is surfaced,
// never silently assumed (the no-false-confidence rule).
//
// Pure presentational. Indigo accent matches CohortBadge so the cohort visual
// identity is consistent across the navigator badge + this panel.
// =============================================================================

interface Props {
  cohort: ProtocolCohort;
}

export default function CohortDetailPanel({ cohort }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const shell = isLight
    ? 'bg-indigo-50/60 border-indigo-200'
    : 'bg-indigo-500/[0.07] border-indigo-400/20';

  return (
    <section
      data-testid="vew-cohort-detail"
      data-cohort={cohort.label}
      aria-label={`Cohort ${cohort.label} details`}
      className={`rounded-lg border px-4 py-3 ${shell}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5">
            <FlaskConical size={11} aria-hidden /> Cohort
          </p>
          <p className="text-fg-heading text-sm font-semibold mt-0.5 truncate">{cohort.label}</p>
        </div>
        {/* Evidence indicator — cited page, or an honest "pending" when uncited. */}
        {cohort.source_page != null ? (
          <span
            className="inline-flex items-center gap-1 text-fg-muted text-[11px] flex-shrink-0"
            title={`Extracted from protocol page ${cohort.source_page}`}
          >
            <FileText size={11} aria-hidden /> p. {cohort.source_page}
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 text-fg-muted text-[11px] flex-shrink-0"
            title="No source citation captured for this cohort — verify against the protocol"
          >
            <AlertCircle size={11} aria-hidden /> source pending
          </span>
        )}
      </div>

      {cohort.dose_regimen && (
        <div className="mt-2">
          <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">Dose</p>
          <p className="text-fg-body text-[13px] mt-0.5 leading-relaxed">{cohort.dose_regimen}</p>
        </div>
      )}

      {cohort.description && (
        <p className="text-fg-sub text-xs mt-2 leading-relaxed">{cohort.description}</p>
      )}

      {!cohort.dose_regimen && !cohort.description && (
        <p className="text-fg-muted text-xs mt-2 leading-relaxed">
          No dose or description was extracted for this cohort. The shared visit schedule below
          applies; verify cohort-specific details against the protocol.
        </p>
      )}
    </section>
  );
}
