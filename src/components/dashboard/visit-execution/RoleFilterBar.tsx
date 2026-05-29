import { Users } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import {
  ROLE_FILTER_OPTIONS,
  ROLE_LABELS,
  type RoleFilter,
} from '../../../types/visit-execution';

// =============================================================================
// RoleFilterBar — Sprint 6.
//
// Chip strip that drives the role-filter lens over the canonical workspace.
// Sits between the snapshot card (overview) and the checklist (narrowed
// view). When a non-`'all'` role is active, the bar also shows a scope hint
// ("Showing N of M requirements") so the coordinator never wonders what got
// dropped from the visible list.
//
// Pure presentational. Parent (VisitExecutionTab) owns the active filter
// state; this component renders the chips + emits onSelect.
//
// Design (per feedback_vew_cognitive_load_test.md):
//   - Chip-strip rather than tabs — lighter visual weight; chips sit on a
//     subtle border row rather than dominating the page hierarchy.
//   - Selected chip uses the canonical primary-button dark fill so it
//     reads as the active action without inventing a new palette.
//   - Unselected chips are quiet borders + text — text-fg-body / hover
//     bg-lift only.
//   - Touch-target floor at min-h-[28px] (tablet-safe).
// =============================================================================

interface Props {
  filter: RoleFilter;
  onSelect: (next: RoleFilter) => void;
  /** Total items in the unfiltered workspace (drives the "of M" hint). */
  totalCount: number;
  /** Items visible under the current filter (drives the "Showing N" hint). */
  filteredCount: number;
}

export default function RoleFilterBar({
  filter,
  onSelect,
  totalCount,
  filteredCount,
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    <section
      data-testid="vew-role-filter-bar"
      data-active-filter={filter}
      aria-label="Filter checklist by role"
      className="space-y-2"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Users
          size={12}
          className={isLight ? 'text-fg-label' : 'text-fg-label'}
          aria-hidden
        />
        <span className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mr-1">
          Role view
        </span>

        {ROLE_FILTER_OPTIONS.map((option) => {
          const isActive = filter === option;
          const label = option === 'all' ? 'All' : ROLE_LABELS[option];
          return (
            <button
              key={option}
              type="button"
              onClick={() => onSelect(option)}
              aria-pressed={isActive}
              data-testid="vew-role-filter-chip"
              data-role={option}
              data-active={isActive}
              // Active treatment intentionally LIGHTER than the canonical
              // primary-button dark fill (used by Export, save drawers, etc.):
              // a filter being active is a SELECTOR state, not a primary
              // ACTION. Subtle bg tint + bolder text + retained border
              // reads as "selected one-of-N" rather than "primary CTA",
              // aligning with the Linear / Stripe filter convention.
              className={`inline-flex items-center px-2.5 py-1 min-h-[32px] rounded-md text-[11px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
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

      {/* Scope hint — only when filter is active. Tells the coordinator
          what they're looking at vs the canonical visit, so the
          snapshot's "12 requirements" stat doesn't feel like a lie
          when the checklist below shows 4 rows.
          Tightened to one line per design-critique; the safety-default
          rule ("unscoped applies to all roles") is in the title attr
          rather than the always-visible status line. */}
      {filter !== 'all' && (
        <p
          data-testid="vew-role-filter-scope-hint"
          title="Unscoped requirements (no role specified) are included for every role view."
          className="text-fg-sub text-[11px] leading-relaxed"
        >
          Showing <span className="font-semibold tabular-nums">{filteredCount}</span> of{' '}
          <span className="font-semibold tabular-nums">{totalCount}</span> requirements
          {' '}(<span className="font-semibold">{ROLE_LABELS[filter]}</span> + unscoped).
        </p>
      )}
    </section>
  );
}
