import { Clock, GitFork, Target, ClipboardCheck, AlertOctagon } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type {
  ExecutionReviewStatus,
  VisitExecutionWorkspace,
} from '../../../types/visit-execution';

// =============================================================================
// VisitNavigator — left rail of the workspace. Lists every visit in the
// protocol (sorted by study_day), shows per-visit indicator chips so the
// coordinator can triage WHICH visit to open before opening any of them.
//
// Indicators (only shown if non-zero / true):
//   - Endpoint-critical count
//   - Safety-critical flag
//   - Conditional rule count
//   - Timing complexity (window = 0 days = strict; rendered as Clock chip)
//   - Needs-review count (computed from local review state map)
//
// Structurally inspired by StageNav, but data shape is per-visit not
// per-stage, so it's a fresh component rather than a reuse.
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
          const needsReviewCount = Math.max(0, ws.items.length - reviewedCount);
          const isTightWindow =
            ws.snapshot.window_minus_days === 0 && ws.snapshot.window_plus_days === 0;

          return (
            <li key={ws.visit_template_id}>
              <button
                type="button"
                onClick={() => onSelect(ws.visit_template_id)}
                aria-current={isSelected ? 'true' : undefined}
                data-testid="vew-navigator-item"
                data-selected={isSelected}
                className={`w-full text-left px-4 py-3 border-l-2 transition-colors ${
                  isSelected
                    ? isLight
                      ? 'bg-white border-[#4a6fa5]'
                      : 'bg-white/[0.04] border-[#6e8fb5]'
                    : isLight
                      ? 'border-transparent hover:bg-[#f0f3f6]'
                      : 'border-transparent hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-sm font-semibold truncate ${
                      isSelected ? 'text-fg-heading' : 'text-fg-body'
                    }`}
                  >
                    {ws.snapshot.visit_name}
                  </span>
                  <span className="text-fg-sub text-[10px] font-medium flex-shrink-0">
                    Day {ws.snapshot.study_day >= 0 ? `+${ws.snapshot.study_day}` : ws.snapshot.study_day}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                  {ws.snapshot.endpoint_critical_count > 0 && (
                    <NavChip
                      icon={<Target size={9} aria-hidden />}
                      label={`${ws.snapshot.endpoint_critical_count}`}
                      title={`${ws.snapshot.endpoint_critical_count} endpoint-critical item${ws.snapshot.endpoint_critical_count === 1 ? '' : 's'}`}
                      tone="rose"
                      isLight={isLight}
                    />
                  )}
                  {ws.snapshot.has_safety_critical && (
                    <NavChip
                      icon={<AlertOctagon size={9} aria-hidden />}
                      label="Safety"
                      title="Safety-critical items at this visit"
                      tone="rose-bold"
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
                  {isTightWindow && (
                    <NavChip
                      icon={<Clock size={9} aria-hidden />}
                      label="Fixed"
                      title="Fixed timing — no permissible window"
                      tone="blue"
                      isLight={isLight}
                    />
                  )}
                  {needsReviewCount > 0 && (
                    <NavChip
                      icon={<ClipboardCheck size={9} aria-hidden />}
                      label={`${needsReviewCount}`}
                      title={`${needsReviewCount} requirement${needsReviewCount === 1 ? '' : 's'} not yet reviewed`}
                      tone="muted"
                      isLight={isLight}
                    />
                  )}
                </div>
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
  tone: 'rose' | 'rose-bold' | 'amber' | 'blue' | 'muted';
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
      case 'blue':
        return isLight
          ? 'text-blue-700 bg-blue-50 border-blue-200'
          : 'text-blue-400 bg-blue-400/10 border-blue-400/20';
      case 'muted':
      default:
        return isLight
          ? 'text-fg-sub bg-[#eef2f6] border-[#e2e8ee]'
          : 'text-fg-sub bg-white/[0.04] border-white/10';
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
