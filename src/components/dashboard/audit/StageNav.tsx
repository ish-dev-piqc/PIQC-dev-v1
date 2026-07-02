import { Check, Lock } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { type AuditStage } from '../../../types/audit';
import { STAGE_LABELS } from '../../../lib/audit/labels';
import { scoreStage } from '../../../lib/heatmap';
import HeatIndicator from '../../heatmap/HeatIndicator';

// =============================================================================
// StageNav — left rail of the audit workspace.
//
// Renders the 8 audit stages as a vertical list. Visual states:
//   - DONE     — stage index < currentStage    : green check, soft text
//   - CURRENT  — stage = currentStage          : blue accent, bold text
//   - NEXT     — stage = currentStage + 1      : clickable to advance (Phase B)
//   - FUTURE   — stage > currentStage + 1      : muted, locked
//   - VIEWED   — stage = viewedStage           : highlighted as the active view
//
// Phase A: any stage at or before currentStage is freely navigable. Forward
// progress (transitioning currentStage) is enforced by Phase B RPCs.
// =============================================================================

interface StageNavProps {
  stages: readonly AuditStage[]; // ordered stage set for this audit's workflow
  currentStage: AuditStage;     // the audit's actual workflow position
  viewedStage: AuditStage;      // the stage currently being viewed
  onSelectStage: (stage: AuditStage) => void;
}

export default function StageNav({ stages, currentStage, viewedStage, onSelectStage }: StageNavProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const currentIdx = stages.indexOf(currentStage);

  const navBg = isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#020617] border-white/5';
  const headerColor = 'text-fg-label';
  const headingColor = 'text-fg-heading';

  return (
    <nav
      aria-label="Audit stages"
      className={`${navBg} border-r flex-shrink-0 w-60 overflow-y-auto hidden md:flex md:flex-col`}
    >
      <div className={`px-4 pt-5 pb-3 border-b ${isLight ? 'border-[#E2E8F0]' : 'border-white/5'}`}>
        <p className={`text-[10px] uppercase tracking-wider font-semibold ${headerColor}`}>
          Audit stage
        </p>
        <p className={`${headingColor} text-sm font-semibold mt-1`}>
          {currentIdx + 1} of {stages.length} — {STAGE_LABELS[currentStage]}
        </p>
      </div>

      <ol className="py-2">
        {stages.map((stage, idx) => {
          const isViewed = stage === viewedStage;
          const isCurrent = stage === currentStage;
          const isDone = idx < currentIdx;
          const isFutureLocked = idx > currentIdx + 1;
          // Phase A — anything up to and including currentStage is navigable.
          const clickable = !isFutureLocked;

          // Visual classes
          const rowBg = isViewed
            ? isLight
              ? 'bg-brand-600/10'
              : 'bg-brand-600/15'
            : 'bg-transparent';
          const accent = isViewed
            ? 'border-l-brand-600'
            : 'border-l-transparent';
          const labelColor = isFutureLocked
            ? isLight
              ? 'text-[#334155]/35'
              : 'text-[#CBD5E1]/30'
            : isViewed
            ? isLight
              ? 'text-brand-600'
              : 'text-brand-300'
            : isLight
            ? 'text-[#0F172A]'
            : 'text-[#CBD5E1]';
          const numberColor = isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/35';

          return (
            <li key={stage}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onSelectStage(stage)}
                aria-current={isCurrent ? 'step' : undefined}
                className={`w-full flex items-start gap-3 pl-3 pr-4 py-2.5 border-l-[3px] ${accent} ${rowBg} transition-colors ${
                  clickable
                    ? isLight
                      ? 'hover:bg-[#0F172A]/[0.04]'
                      : 'hover:bg-white/[0.04]'
                    : 'cursor-default'
                }`}
              >
                <StageDot
                  done={isDone}
                  current={isCurrent}
                  futureLocked={isFutureLocked}
                  isLight={isLight}
                />
                <div className="flex-1 min-w-0 text-left">
                  <div className={`text-[11px] font-medium ${numberColor}`}>
                    Stage {idx + 1}
                  </div>
                  <div className={`text-sm ${isCurrent || isViewed ? 'font-semibold' : 'font-medium'} ${labelColor} truncate`}>
                    {STAGE_LABELS[stage]}
                  </div>
                </div>
                {/* Heat: cross-audit "this stage commonly stalls" signal.
                    Hidden on done stages (no signal needed once past it). */}
                {!isDone && (
                  <HeatIndicator
                    score={scoreStage(stage)}
                    variant="bar"
                    hint="cross-audit stage friction"
                    className="self-stretch my-0.5"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface StageDotProps {
  done: boolean;
  current: boolean;
  futureLocked: boolean;
  isLight: boolean;
}

function StageDot({ done, current, futureLocked, isLight }: StageDotProps) {
  if (done) {
    return (
      <span
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full mt-0.5 flex-shrink-0 ${
          isLight ? 'bg-emerald-500/15 text-emerald-600' : 'bg-emerald-500/20 text-emerald-400'
        }`}
      >
        <Check size={12} strokeWidth={3} />
      </span>
    );
  }
  if (current) {
    return (
      <span
        className={`inline-block w-5 h-5 rounded-full mt-0.5 flex-shrink-0 ring-2 ring-offset-2 ${
          isLight
            ? 'bg-brand-600 ring-brand-600/30 ring-offset-[#F8FAFC]'
            : 'bg-brand-300 ring-brand-300/30 ring-offset-[#020617]'
        }`}
      />
    );
  }
  if (futureLocked) {
    return (
      <span
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full mt-0.5 flex-shrink-0 ${
          isLight ? 'bg-[#0F172A]/[0.04] text-[#334155]/35' : 'bg-white/[0.04] text-[#CBD5E1]/30'
        }`}
      >
        <Lock size={10} />
      </span>
    );
  }
  // Next stage (currentIdx + 1) — empty pending dot
  return (
    <span
      className={`inline-block w-5 h-5 rounded-full mt-0.5 flex-shrink-0 border-2 ${
        isLight ? 'border-[#CBD5E1]' : 'border-white/15'
      }`}
    />
  );
}
