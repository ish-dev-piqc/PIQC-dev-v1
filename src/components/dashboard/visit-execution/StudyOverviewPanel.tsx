import { AlertOctagon, ChevronRight, GitFork, Map, Pill, Target, Users } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { StudyBrief } from '../../../lib/visit-execution/studyBriefModel';
import CohortBadge from './CohortBadge';

// =============================================================================
// StudyOverviewPanel — the reading pattern one level up (narrative-first
// S1.6). Selected via the navigator's pinned "Study overview" node; renders
// the study's SHAPE: a derived orient line, the visit arc (click-through),
// and the cohorts with their dose regimens. The protocol-wide DivergencePanel
// is composed by the parent directly below this panel — not in here — so the
// divergence UI keeps a single owner.
//
// Attribution: the orient line is MECHANICAL derivation (counts/spans), so it
// is labeled "Derived from the parsed schedule" — NOT "PIQC drafted", which
// the doctrine reserves for composed prose.
// =============================================================================

interface Props {
  brief: StudyBrief;
  onSelectVisit: (visitTemplateId: string) => void;
}

export default function StudyOverviewPanel({ brief, onSelectVisit }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';

  return (
    <div className="space-y-5" data-testid="vew-study-overview">
      {/* ---- Orient ---- */}
      <section className={`rounded-2xl border ${cardBg} p-5`} aria-label="Study shape">
        <div className="flex items-center gap-2 flex-wrap">
          <Map size={13} className="text-brand-500 flex-shrink-0" aria-hidden />
          <h3 className="text-fg-heading text-sm font-semibold">The study, in brief</h3>
          <span className="ml-auto text-fg-muted text-[11px]">
            Derived from the parsed schedule
          </span>
        </div>
        <p className="text-fg-body text-sm leading-relaxed mt-3" data-testid="vew-study-orient">
          {brief.orient}
        </p>
        {brief.openDivergenceCount > 0 && (
          <p className="mt-2 text-[13px] text-amber-800 dark:text-amber-300">
            ⚠ The protocol disagrees with itself in {brief.openDivergenceCount} place
            {brief.openDivergenceCount === 1 ? '' : 's'} — every one is in the panel below.
          </p>
        )}
      </section>

      {/* ---- The arc ---- */}
      {brief.arc.length > 0 && (
        <section className={`rounded-2xl border ${cardBg} p-5`} aria-label="Visit arc">
          <h3 className="text-fg-heading text-sm font-semibold">The visits, in order</h3>
          <ol
            className={`mt-3 border-l-2 ml-1.5 pl-4 space-y-1 ${
              isLight ? 'border-[#E2E8F0]' : 'border-white/10'
            }`}
          >
            {brief.arc.map((v) => (
              <li key={v.visit_template_id} className="relative">
                <span
                  aria-hidden
                  className={`absolute -left-[23px] top-[11px] w-2.5 h-2.5 rounded-full border-2 ${
                    v.isDosing
                      ? 'border-brand-500 bg-brand-100 dark:bg-brand-500/20'
                      : isLight
                        ? 'border-[#CBD5E1] bg-white'
                        : 'border-white/25 bg-[#0F172A]'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => onSelectVisit(v.visit_template_id)}
                  data-testid="vew-study-arc-visit"
                  className={`w-full text-left rounded-md px-2 py-1.5 -ml-2 flex items-center gap-2 ${
                    isLight ? 'hover:bg-[#F8FAFC]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <span className="text-fg-body text-sm font-medium">{v.visit_name}</span>
                  <span className="text-fg-muted text-[11px] tabular-nums">
                    {v.dayLabel}
                    {v.windowLabel ? ` · ${v.windowLabel}` : ''}
                  </span>
                  {v.appliesTo.map((c) => (
                    <CohortBadge key={c} label={c} />
                  ))}
                  <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    {v.hasSafetyCritical && (
                      <AlertOctagon
                        size={11}
                        aria-hidden
                        className="text-rose-600 dark:text-rose-400"
                      />
                    )}
                    {v.endpointCriticalCount > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-400 tabular-nums"
                        title={`${v.endpointCriticalCount} endpoint-critical`}
                      >
                        <Target size={10} aria-hidden />
                        {v.endpointCriticalCount}
                      </span>
                    )}
                    {v.conditionalCount > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 tabular-nums"
                        title={`${v.conditionalCount} conditional`}
                      >
                        <GitFork size={10} aria-hidden />
                        {v.conditionalCount}
                      </span>
                    )}
                    <ChevronRight size={12} aria-hidden className="text-fg-muted" />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ---- Cohorts ---- */}
      {brief.cohorts.length > 0 && (
        <section className={`rounded-2xl border ${cardBg} p-5`} aria-label="Cohorts">
          <div className="flex items-center gap-2">
            <Users size={13} className="text-brand-500 flex-shrink-0" aria-hidden />
            <h3 className="text-fg-heading text-sm font-semibold">Cohorts</h3>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {brief.cohorts.map((c) => (
              <div
                key={c.label}
                data-testid="vew-study-cohort"
                className={`rounded-lg border px-3.5 py-3 ${
                  isLight ? 'border-[#E2E8F0] bg-[#F8FAFC]' : 'border-white/[0.06] bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <CohortBadge label={c.label} />
                  <span className="text-fg-muted text-[11px] tabular-nums">
                    {c.visitCount} visit{c.visitCount === 1 ? '' : 's'}
                  </span>
                  {c.sourcePage !== null && (
                    <span className="ml-auto text-fg-muted font-mono text-[10px]">
                      p {c.sourcePage}
                    </span>
                  )}
                </div>
                {c.doseRegimen && (
                  <p className="mt-1.5 text-[13px] text-fg-body flex items-start gap-1.5">
                    <Pill size={11} aria-hidden className="mt-1 flex-shrink-0 text-fg-muted" />
                    <span>{c.doseRegimen}</span>
                  </p>
                )}
                {c.description && (
                  <p className="mt-1 text-[12px] text-fg-sub leading-relaxed">{c.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
