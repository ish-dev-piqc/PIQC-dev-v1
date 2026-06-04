import { AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { VisitCoverage } from '../../../types/visit-execution';

// =============================================================================
// CoverageBanner (#4) — protocol-level completeness. Renders when the ingest
// coverage check found gaps (visits the schedule implies but that aren't
// present), OR when the schedule was extracted via the LLM fallback / a
// low-confidence grid parse — so an extraction collapse is never silent. Review
// surface: it never edits data, just surfaces what to verify.
// =============================================================================

interface Props {
  coverage: VisitCoverage | null;
}

export default function CoverageBanner({ coverage }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const method = coverage?.extraction_method ?? null;
  const extractionFlagged = method === 'llm_fallback' || method === 'grid_low_confidence';

  // Show when there are gaps OR the extraction itself is flagged.
  if (!coverage || (coverage.missing.length === 0 && !extractionFlagged)) return null;

  const { found_count, expected_count, missing } = coverage;

  const extractionNote =
    method === 'llm_fallback'
      ? 'Extraction used the AI fallback (the schedule table couldn’t be read directly) — verify the per-visit checklists and re-run if needed.'
      : method === 'grid_low_confidence'
        ? 'The schedule table was read but flagged low-confidence — verify the per-visit checklists.'
        : null;

  return (
    <div
      data-testid="vew-coverage-banner"
      className={`rounded-lg border px-3 py-2.5 ${
        isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-400/10 border-amber-400/20'
      }`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={14}
          className={`flex-shrink-0 mt-0.5 ${isLight ? 'text-amber-700' : 'text-amber-400'}`}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-fg-heading text-xs font-semibold">
            {missing.length > 0
              ? `${found_count} of ${expected_count} expected visits — ${missing.length} to review`
              : 'Schedule extraction needs review'}
          </p>
          {extractionNote && (
            <p className="text-fg-sub text-[11px] leading-snug mt-0.5">{extractionNote}</p>
          )}
          <ul className="mt-1 space-y-0.5">
            {missing.slice(0, 6).map((g, i) => (
              <li key={`${g.label}-${i}`} className="text-fg-sub text-[11px] leading-snug">
                <span className="font-medium text-fg-body">{g.label}</span>
                {g.reason ? <span> — {g.reason}</span> : null}
              </li>
            ))}
          </ul>
          {missing.length > 6 && (
            <p className="text-fg-muted text-[11px] mt-1">+{missing.length - 6} more</p>
          )}
        </div>
      </div>
    </div>
  );
}
