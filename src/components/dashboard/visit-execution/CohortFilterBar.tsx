import { Layers } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// CohortFilterBar — Slice 2 (cohort applicability).
//
// Chip strip that filters the visit list to one study cohort/arm (SAD / MAD /
// CSF / …). Rendered in the navigator header ONLY when a protocol actually has
// cohorts (≥2 distinct, surfaced via visit applies_to). "All" shows every visit;
// a cohort shows that cohort's visits PLUS shared/unscoped ones (applies_to
// null) — the same "unscoped → shows everywhere" rule as the role filter.
//
// Pure presentational; the parent (VisitExecutionTab) owns the active value and
// does the filtering. Styling mirrors RoleFilterBar (selected = subtle fill +
// border; unselected = quiet border + hover lift).
// =============================================================================

interface Props {
  /** Distinct cohort labels present in the protocol (union of visit applies_to). */
  cohorts: string[];
  /** Active cohort, or 'all'. */
  value: string;
  onSelect: (next: string) => void;
}

export default function CohortFilterBar({ cohorts, value, onSelect }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const options = ['all', ...cohorts];

  return (
    <section
      data-testid="vew-cohort-filter-bar"
      data-active-cohort={value}
      aria-label="Filter visits by cohort"
      className="space-y-2"
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <Layers size={12} className="text-fg-label" aria-hidden />
        <span className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mr-1">
          Cohort
        </span>
        {options.map((opt) => {
          const isActive = value === opt;
          const label = opt === 'all' ? 'All' : opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onSelect(opt)}
              aria-pressed={isActive}
              data-testid="vew-cohort-filter-chip"
              data-cohort={opt}
              data-active={isActive}
              className={`inline-flex items-center px-2 py-0.5 min-h-[28px] rounded-md text-[11px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                isActive
                  ? isLight
                    ? 'bg-[#E2E8F0] border border-[#1E293B] text-fg-heading focus-visible:ring-[#1E293B]'
                    : 'bg-white/[0.10] border border-white/40 text-fg-heading focus-visible:ring-white/60'
                  : isLight
                  ? 'bg-transparent border border-[#CBD5E1] text-fg-body hover:bg-[#F2F2F2] focus-visible:ring-[#94A3B8]'
                  : 'bg-transparent border border-white/10 text-fg-body hover:bg-white/[0.04] focus-visible:ring-white/30'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
