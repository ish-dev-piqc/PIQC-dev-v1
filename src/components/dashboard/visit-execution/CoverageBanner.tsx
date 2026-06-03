import { AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { VisitCoverage } from '../../../types/visit-execution';

// =============================================================================
// CoverageBanner (#4) — protocol-level completeness. Renders ONLY when the
// ingest coverage check found gaps (visits the schedule implies but that aren't
// present). Review surface: it never edits data, just surfaces what to verify.
// =============================================================================

interface Props {
  coverage: VisitCoverage | null;
}

export default function CoverageBanner({ coverage }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  if (!coverage || coverage.missing.length === 0) return null;

  const { found_count, expected_count, missing } = coverage;

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
            {found_count} of {expected_count} expected visits — {missing.length} to review
          </p>
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
