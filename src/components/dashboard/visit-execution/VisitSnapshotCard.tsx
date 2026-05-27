import { Sparkles, Target, AlertOctagon, GitFork, ClipboardCheck } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { VisitSnapshot } from '../../../types/visit-execution';
import TimingBanner from './TimingBanner';

// =============================================================================
// VisitSnapshotCard — above-the-fold summary for the selected visit.
//
// Polish-v2 (2026-05-27) per feedback_vew_cognitive_load_test.md:
//   1. Drop the "PIQC drafted ·" decorative prefix on purpose prose — the
//      provenance is conveyed by the Sparkles icon + the workspace context.
//      The prefix added pixels without changing what the user does.
//   2. Replace the cramped "12 requirements · 4 reviewed" footer caption
//      with a Linear-style 3-cell stat grid (total / reviewed / open) so
//      progress is glanceable.
//   3. Soften the "Dosing visit" chip — it's a static fact for the visit,
//      not an alert; doesn't need an outlined badge competing with
//      attention chips.
//   4. Cap attention chips at 3 (rule kept from earlier polish).
//
// Information density unchanged — every signal still surfaced. Failure mode
// guarded against: "PIQC re-renders protocol complexity in card form with
// no presentation gain."
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
              // Polish-v2: dosing-visit is a static type label, not an
              // alert — softened to text-only indigo so it doesn't compete
              // for attention with the chip row below.
              <span
                className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-400"
              >
                · Dosing visit
              </span>
            )}
          </div>
          {/* Polish-v2: dropped "PIQC drafted ·" decorative prefix. Provenance
              is conveyed by the Sparkles icon above + the workspace context. */}
          <p className="text-fg-body text-sm leading-relaxed mt-2">
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

      {/* Polish-v2: Linear-style 3-cell stat grid replaces the cramped
          single-line footer caption. Each cell teaches one fact about the
          coordinator's progress on this visit. Amendment row pinned right
          stays subtle — non-zero amendment is informational, not action. */}
      <div
        className={`pt-3 border-t ${isLight ? 'border-[#eef2f6]' : 'border-white/[0.04]'}`}
        data-testid="vew-snapshot-stats"
      >
        <div className="grid grid-cols-3 gap-2">
          <Stat
            label="Requirements"
            value={snapshot.item_count}
            valueClass="text-fg-heading"
          />
          <Stat
            label="Reviewed"
            value={reviewedCount}
            valueClass={
              reviewedCount > 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-fg-heading'
            }
          />
          <Stat
            label="Open"
            value={needsReviewCount}
            valueClass={
              needsReviewCount > 0
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-fg-heading'
            }
          />
        </div>
        {snapshot.amendment_version && (
          <p className="text-fg-muted text-[11px] mt-2.5">
            Reflects {snapshot.amendment_version}
          </p>
        )}
      </div>
    </section>
  );
}


function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: number;
  valueClass: string;
}) {
  return (
    <div>
      <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
        {label}
      </p>
      <p className={`text-xl font-semibold mt-0.5 tabular-nums ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}
