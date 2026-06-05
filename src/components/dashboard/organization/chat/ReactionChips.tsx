import { useTheme } from '../../../../context/ThemeContext';
import type { ReactionChip } from '../../../../lib/orgs/chatReactionsAdapter';

// =============================================================================
// ReactionChips — row of emoji+count chips rendered under a message bubble.
// Each chip is click-toggleable: clicking adds the caller's reaction if
// not yet present, removes it if it is.
// =============================================================================

interface ReactionChipsProps {
  chips: ReactionChip[];
  isSelfMessage: boolean;
  onToggle: (emoji: string) => void;
}

export default function ReactionChips({
  chips,
  isSelfMessage,
  onToggle,
}: ReactionChipsProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  if (chips.length === 0) return null;

  const activeClass = isLight
    ? 'bg-brand-600/[0.10] text-brand-600 border-brand-600/30'
    : 'bg-brand-300/[0.15] text-brand-300 border-brand-300/30';
  const inactiveClass = isLight
    ? 'bg-[#F8FAFC] text-[#334155] border-[#E2E8F0] hover:bg-[#0F172A]/[0.04]'
    : 'bg-white/[0.04] text-[#CBD5E1] border-white/10 hover:bg-white/[0.07]';

  return (
    <div className={`flex flex-wrap gap-1 mt-1 ${isSelfMessage ? 'justify-end' : 'justify-start'}`}>
      {chips.map((chip) => (
        <button
          key={chip.emoji}
          type="button"
          onClick={() => onToggle(chip.emoji)}
          className={`inline-flex items-center gap-1 text-[11px] rounded-full border px-2 py-0.5 leading-none ${
            chip.selfReacted ? activeClass : inactiveClass
          }`}
          title={`${chip.count} reaction${chip.count === 1 ? '' : 's'}${
            chip.selfReacted ? ' (you reacted)' : ''
          }`}
        >
          <span>{chip.emoji}</span>
          <span className="font-medium tabular-nums">{chip.count}</span>
        </button>
      ))}
    </div>
  );
}
