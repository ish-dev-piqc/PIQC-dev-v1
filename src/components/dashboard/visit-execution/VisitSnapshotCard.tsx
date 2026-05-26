import { Sparkles, Target, AlertOctagon, GitFork, ClipboardCheck } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { VisitSnapshot } from '../../../types/visit-execution';
import TimingBanner from './TimingBanner';

// =============================================================================
// VisitSnapshotCard — above-the-fold summary for the selected visit.
//
// Design rules baked in:
//   1. Only NON-ZERO critical indicators render as chips. Zero counts hide.
//   2. Cap at 3 visible chips above the snapshot line.
//   3. The "PIQC drafted this" signal is in the card header — NOT a
//      dismissable banner — because it's permanent context for the surface.
//   4. The TimingBanner sits below the snapshot stat row so the visit
//      window is always visible without the user scrolling.
// =============================================================================

interface Props {
  snapshot: VisitSnapshot;
  reviewedCount: number;
  totalItems: number;
}

interface Chip {
  key: string;
  label: string;
  count: number;
  icon: React.ReactNode;
  toneLight: string;
  toneDark: string;
}

function buildChips(snapshot: VisitSnapshot, needsReviewCount: number): Chip[] {
  const chips: Chip[] = [];

  if (snapshot.endpoint_critical_count > 0) {
    chips.push({
      key: 'endpoints',
      label: 'Endpoint-critical',
      count: snapshot.endpoint_critical_count,
      icon: <Target size={11} aria-hidden />,
      toneLight: 'text-rose-700 bg-rose-50 border-rose-200',
      toneDark: 'dark:text-rose-400 dark:bg-rose-400/10 dark:border-rose-400/20',
    });
  }
  if (snapshot.has_safety_critical) {
    chips.push({
      key: 'safety',
      label: 'Safety-critical',
      count: 1,
      icon: <AlertOctagon size={11} aria-hidden />,
      toneLight: 'text-rose-800 bg-rose-100 border-rose-300',
      toneDark: 'dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-400/30',
    });
  }
  if (snapshot.conditional_item_count > 0) {
    chips.push({
      key: 'conditional',
      label: 'Conditional',
      count: snapshot.conditional_item_count,
      icon: <GitFork size={11} aria-hidden />,
      toneLight: 'text-amber-700 bg-amber-50 border-amber-200',
      toneDark: 'dark:text-amber-400 dark:bg-amber-400/10 dark:border-amber-400/20',
    });
  }
  if (needsReviewCount > 0) {
    chips.push({
      key: 'needs-review',
      label: 'Needs review',
      count: needsReviewCount,
      icon: <ClipboardCheck size={11} aria-hidden />,
      toneLight: 'text-blue-700 bg-blue-50 border-blue-200',
      toneDark: 'dark:text-blue-400 dark:bg-blue-400/10 dark:border-blue-400/20',
    });
  }

  return chips.slice(0, 3);
}

export default function VisitSnapshotCard({ snapshot, reviewedCount, totalItems }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';

  const needsReviewCount = Math.max(0, totalItems - reviewedCount);
  const chips = buildChips(snapshot, needsReviewCount);

  return (
    <section
      data-testid="vew-snapshot-card"
      className={`rounded-2xl border ${cardBg} p-5 space-y-4`}
      aria-label="Visit summary"
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-md ${
            isLight ? 'bg-[#eef2f6] text-[#4a6fa5]' : 'bg-white/[0.04] text-[#6e8fb5]'
          }`}
          aria-hidden
        >
          <Sparkles size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-fg-heading text-lg font-semibold">
              {snapshot.visit_name}
            </h2>
            <span className="text-fg-sub text-xs font-medium">
              Study Day {snapshot.study_day >= 0 ? `+${snapshot.study_day}` : snapshot.study_day}
            </span>
            {snapshot.is_dosing_visit && (
              <span
                className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider rounded-md border px-1.5 py-0.5 ${
                  isLight
                    ? 'text-indigo-700 bg-indigo-50 border-indigo-200'
                    : 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20'
                }`}
              >
                Dosing visit
              </span>
            )}
          </div>
          <p className="text-fg-body text-sm leading-relaxed mt-1.5">
            <span className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mr-2">
              PIQC drafted ·
            </span>
            {snapshot.purpose}
          </p>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Visit attention indicators">
          {chips.map((chip) => (
            <span
              key={chip.key}
              data-testid={`vew-snapshot-chip-${chip.key}`}
              className={`inline-flex items-center gap-1 font-semibold uppercase tracking-wider rounded-md border text-[10px] px-1.5 py-0.5 ${chip.toneLight} ${chip.toneDark}`}
            >
              {chip.icon}
              <span>
                {chip.count > 1 ? `${chip.count} ` : ''}{chip.label}
              </span>
            </span>
          ))}
        </div>
      )}

      <TimingBanner snapshot={snapshot} />

      <div className={`pt-3 border-t flex items-center justify-between text-xs ${
        isLight ? 'border-[#eef2f6]' : 'border-white/[0.04]'
      }`}>
        <span className="text-fg-sub">
          {snapshot.item_count} requirement{snapshot.item_count === 1 ? '' : 's'} · {reviewedCount} reviewed
        </span>
        {snapshot.amendment_version && (
          <span className="text-fg-muted">{snapshot.amendment_version}</span>
        )}
      </div>
    </section>
  );
}
