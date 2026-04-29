import { Check, Lock } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { AUDIT_STAGES, type AuditStage } from '../../../types/audit';
import { STAGE_LABELS } from '../../../lib/audit/labels';

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
  currentStage: AuditStage;     // the audit's actual workflow position
  viewedStage: AuditStage;      // the stage currently being viewed
  onSelectStage: (stage: AuditStage) => void;
}

export default function StageNav({ currentStage, viewedStage, onSelectStage }: StageNavProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const currentIdx = AUDIT_STAGES.indexOf(currentStage);

  const navBg = isLight ? 'bg-[#f9fafc] border-[#e2e8ee]' : 'bg-[#0e141b] border-white/5';
  const headerColor = isLight ? 'text-[#374152]/45' : 'text-[#d2d7e0]/40';
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';

  return (
    <nav
      aria-label="Audit stages"
      className={`${navBg} border-r flex-shrink-0 w-60 overflow-y-auto hidden md:flex md:flex-col`}
    >
      <div className={`px-4 pt-5 pb-3 border-b ${isLight ? 'border-[#e2e8ee]' : 'border-white/5'}`}>
        <p className={`text-[10px] uppercase tracking-wider font-semibold ${headerColor}`}>
          Audit stage
        </p>
        <p className={`${headingColor} text-sm font-semibold mt-1`}>
          {currentIdx + 1} of {AUDIT_STAGES.length} — {STAGE_LABELS[currentStage]}
        </p>
      </div>

      <ol className="py-2">
        {AUDIT_STAGES.map((stage, idx) => {
          const isViewed = stage === viewedStage;
          const isCurrent = stage === currentStage;
          const isDone = idx < currentIdx;
          const isFutureLocked = idx > currentIdx + 1;
          // Phase A — anything up to and including currentStage is navigable.
          const clickable = !isFutureLocked;

          // Visual classes
          const rowBg = isViewed
            ? isLight
              ? 'bg-[#4a6fa5]/10'
              : 'bg-[#4a6fa5]/15'
            : 'bg-transparent';
          const accent = isViewed
            ? 'border-l-[#4a6fa5]'
            : 'border-l-transparent';
          const labelColor = isFutureLocked
            ? isLight
              ? 'text-[#374152]/35'
              : 'text-[#d2d7e0]/30'
            : isViewed
            ? isLight
              ? 'text-[#4a6fa5]'
              : 'text-[#6e8fb5]'
            : isLight
            ? 'text-[#1a1f28]'
            : 'text-[#d2d7e0]';
          const numberColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';

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
                      ? 'hover:bg-[#1a1f28]/[0.04]'
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
            ? 'bg-[#4a6fa5] ring-[#4a6fa5]/30 ring-offset-[#f9fafc]'
            : 'bg-[#6e8fb5] ring-[#6e8fb5]/30 ring-offset-[#0e141b]'
        }`}
      />
    );
  }
  if (futureLocked) {
    return (
      <span
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full mt-0.5 flex-shrink-0 ${
          isLight ? 'bg-[#1a1f28]/[0.04] text-[#374152]/35' : 'bg-white/[0.04] text-[#d2d7e0]/30'
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
        isLight ? 'border-[#cbd2db]' : 'border-white/15'
      }`}
    />
  );
}
