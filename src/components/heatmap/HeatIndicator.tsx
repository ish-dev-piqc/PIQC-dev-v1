import { Activity } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useHeatmap } from '../../context/HeatmapContext';
import {
  HEAT_LABELS,
  HEAT_TONES_LIGHT,
  HEAT_TONES_DARK,
  HEAT_BAR_LIGHT,
  HEAT_BAR_DARK,
  type HeatScore,
} from '../../lib/heatmap';

// =============================================================================
// HeatIndicator — visual marker for the cross-study heatmap layer.
//
// Two variants:
//   - 'bar'  : a thin vertical accent on the right edge. Compact; for tight
//              spaces like calendar visit cells. Tooltip via title attr.
//   - 'chip' : a small pill with icon + label. For card-style surfaces with
//              room for an explanation.
//
// Renders nothing when:
//   - the heatmap layer is toggled off (HeatmapContext.enabled === false)
//   - the score is 'none'
// =============================================================================

interface HeatIndicatorProps {
  score: HeatScore;
  variant?: 'bar' | 'chip';
  // Optional explanation appended to the tooltip — gives the user context
  // beyond the level word ("commonly window deviations on early-engagement
  // visits", etc.)
  hint?: string;
  className?: string;
}

export default function HeatIndicator({
  score,
  variant = 'bar',
  hint,
  className,
}: HeatIndicatorProps) {
  const { theme } = useTheme();
  const { enabled } = useHeatmap();
  const isLight = theme === 'light';

  if (!enabled || score === 'none') return null;

  const title = hint ? `${HEAT_LABELS[score]} — ${hint}` : HEAT_LABELS[score];

  if (variant === 'bar') {
    const bar = isLight ? HEAT_BAR_LIGHT[score] : HEAT_BAR_DARK[score];
    return (
      <span
        title={title}
        aria-label={title}
        className={`inline-block w-1 self-stretch rounded-full ${bar} ${className ?? ''}`}
      />
    );
  }

  const tone = isLight ? HEAT_TONES_LIGHT[score] : HEAT_TONES_DARK[score];
  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tone} ${className ?? ''}`}
    >
      <Activity size={10} />
      {scoreShortLabel(score)}
    </span>
  );
}

function scoreShortLabel(score: HeatScore): string {
  switch (score) {
    case 'low':
      return 'Common: low';
    case 'moderate':
      return 'Common: moderate';
    case 'high':
      return 'Common: high';
    case 'none':
      return '';
  }
}
