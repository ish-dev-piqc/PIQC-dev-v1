import { GitFork, Target, AlertOctagon } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type {
  ExecutionReviewStatus,
  VisitExecutionWorkspace,
} from '../../../types/visit-execution';

// =============================================================================
// VisitNavigator — left rail of the workspace. Lists every visit in the
// protocol (sorted by study_day).
//
// Polish-v2 (2026-05-27) per feedback_vew_cognitive_load_test.md:
//   The earlier version surfaced up to 5 chips per visit at 9px text —
//   dense to the point of unreadable. Polish consolidates:
//
//   1. Two attention chips only: endpoint-critical count, safety dot.
//      Conditional / tight-window / needs-review get folded into a single
//      "open items" counter pinned right, which the coordinator already
//      cares about most ("which visits still have work to do?").
//
//   2. Stronger selected state — the 2px left border was too quiet against
//      the row hover treatment. Now selected uses a filled left rail + a
//      stronger background lift so the eye lands on the active visit
//      immediately when sweeping the list.
//
//   3. Day badge moved from right-of-name to a labeled sub-line — frees
//      the right side for the open-items counter and stops competing with
//      the visit name for hierarchy.
// =============================================================================

interface Props {
  workspaces: VisitExecutionWorkspace[];
  selectedVisitTemplateId: string | null;
  onSelect: (visitTemplateId: string) => void;
  reviewStatusByItemId: Map<string, ExecutionReviewStatus>;
}

export default function VisitNavigator({
  workspaces,
  selectedVisitTemplateId,
  onSelect,
  reviewStatusByItemId,
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const navBg = isLight
    ? 'bg-[#f9fafc] border-[#e2e8ee]'
    : 'bg-[#0e141b] border-white/5';

  return (
    <nav
      aria-label="Protocol visits"
      data-testid="vew-navigator"
      className={`${navBg} border-r flex-shrink-0 w-72 overflow-y-auto hidden md:flex md:flex-col`}
    >
      <div className={`px-4 pt-5 pb-3 border-b ${isLight ? 'border-[#e2e8ee]' : 'border-white/5'}`}>
        <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          Visit
        </p>
        <p className="text-fg-heading text-sm font-semibold mt-1">
          {workspaces.length} visit{workspaces.length === 1 ? '' : 's'} in protocol
        </p>
      </div>

      <ol className="py-2">
        {workspaces.map((ws) => {
          const isSelected = ws.visit_template_id === selectedVisitTemplateId;
          const reviewedCount = ws.items.filter(
            (i) => (reviewStatusByItemId.get(i.id) ?? i.review_status) === 'reviewed',
          ).length;
          const openCount = Math.max(0, ws.items.length - reviewedCount);
          const dayLabel =
            ws.snapshot.study_day >= 0
              ? `Day +${ws.snapshot.study_day}`
              : `Day ${ws.snapshot.study_day}`;

          return (
            <li key={ws.visit_template_id}>
              <button
                type="button"
                onClick={() => onSelect(ws.visit_template_id)}
                aria-current={isSelected ? 'true' : undefined}
                data-testid="vew-navigator-item"
                data-selected={isSelected}
                className={`w-full text-left px-4 py-3 border-l-[3px] transition-colors ${
                  isSelected
                    ? isLight
                      ? 'bg-white border-[#1f2937]'
                      : 'bg-white/[0.06] border-white'
                    : isLight
                      ? 'border-transparent hover:bg-[#f0f3f6]'
                      : 'border-transparent hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm font-semibold truncate ${
                        isSelected ? 'text-fg-heading' : 'text-fg-body'
                      }`}
                    >
                      {ws.snapshot.visit_name}
                    </p>
                    <p className="text-fg-muted text-[11px] mt-0.5">{dayLabel}</p>
                  </div>

                  {/* Counter pinned right. Verb-aligned label ("to review"
                      not "open") tells the coordinator what they DO with
                      this count. Quiet by default; amber when non-zero so
                      the visits-with-work jump out on a sweep. Zero-state
                      shows nothing — hides done visits gracefully. */}
                  {openCount > 0 && (
                    <span
                      className={`text-[11px] font-semibold tabular-nums flex-shrink-0 ${
                        isLight
                          ? 'text-amber-700'
                          : 'text-amber-400'
                      }`}
                      title={`${openCount} requirement${openCount === 1 ? '' : 's'} not yet reviewed`}
                    >
                      {openCount} to review
                    </span>
                  )}
                </div>

                {/* Attention chips — only the rare-but-loud signals.
                    Endpoint-critical: shows count.
                    Safety-critical: presence-only (a single dot is enough). */}
                {(ws.snapshot.endpoint_critical_count > 0 ||
                  ws.snapshot.has_safety_critical ||
                  ws.snapshot.conditional_item_count > 0) && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {ws.snapshot.has_safety_critical && (
                      <NavChip
                        icon={<AlertOctagon size={9} aria-hidden />}
                        label="Safety"
                        title="Safety-critical items at this visit"
                        tone="rose-bold"
                        isLight={isLight}
                      />
                    )}
                    {ws.snapshot.endpoint_critical_count > 0 && (
                      <NavChip
                        icon={<Target size={9} aria-hidden />}
                        label={`${ws.snapshot.endpoint_critical_count}`}
                        title={`${ws.snapshot.endpoint_critical_count} endpoint-critical item${ws.snapshot.endpoint_critical_count === 1 ? '' : 's'}`}
                        tone="rose"
                        isLight={isLight}
                      />
                    )}
                    {ws.snapshot.conditional_item_count > 0 && (
                      <NavChip
                        icon={<GitFork size={9} aria-hidden />}
                        label={`${ws.snapshot.conditional_item_count}`}
                        title={`${ws.snapshot.conditional_item_count} conditional rule${ws.snapshot.conditional_item_count === 1 ? '' : 's'}`}
                        tone="amber"
                        isLight={isLight}
                      />
                    )}
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}


function NavChip({
  icon,
  label,
  title,
  tone,
  isLight,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  tone: 'rose' | 'rose-bold' | 'amber';
  isLight: boolean;
}) {
  const toneClass = (() => {
    switch (tone) {
      case 'rose':
        return isLight
          ? 'text-rose-700 bg-rose-50 border-rose-200'
          : 'text-rose-400 bg-rose-400/10 border-rose-400/20';
      case 'rose-bold':
        return isLight
          ? 'text-rose-800 bg-rose-100 border-rose-300 font-bold'
          : 'text-rose-300 bg-rose-500/15 border-rose-400/30 font-bold';
      case 'amber':
        return isLight
          ? 'text-amber-700 bg-amber-50 border-amber-200'
          : 'text-amber-400 bg-amber-400/10 border-amber-400/20';
    }
  })();
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border px-1 py-0.5 ${toneClass}`}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}
