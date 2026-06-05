import { useEffect } from 'react';
import { useTheme } from '../../../../context/ThemeContext';

// =============================================================================
// ReactionPicker — small floating row of six emojis. Click an emoji to
// toggle the caller's own reaction (add or remove). Closes on outside
// click or Escape.
// =============================================================================

/** Slate of emojis offered in the quick picker. Six fixed picks rather
 *  than a full keyboard for v1 — covers the common chat-trial cases
 *  (acks, attention, concern, gratitude, charts/data). */
export const REACTION_EMOJIS: ReadonlyArray<string> = [
  '👍',
  '✅',
  '❤️',
  '😬',
  '🙏',
  '📊',
];

interface ReactionPickerProps {
  /** Anchor side: 'left' aligns the popover to the left of its parent
   *  (used for non-self messages); 'right' aligns right (self messages). */
  anchor: 'left' | 'right';
  onPick: (emoji: string) => void;
  onClose: () => void;
}

export default function ReactionPicker({ anchor, onPick, onClose }: ReactionPickerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const hoverBg = isLight ? 'hover:bg-[#0F172A]/[0.05]' : 'hover:bg-white/[0.06]';

  return (
    <>
      {/* Backdrop catcher — fixed so outside click closes regardless of
          scroll position. */}
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
      <div
        className={`absolute z-40 top-full mt-1 ${
          anchor === 'right' ? 'right-0' : 'left-0'
        } flex items-center gap-0.5 rounded-md border shadow-md px-1 py-1 ${border} ${bg}`}
        onClick={(e) => e.stopPropagation()}
      >
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              onPick(emoji);
              onClose();
            }}
            className={`text-base leading-none px-1.5 py-1 rounded ${hoverBg}`}
            aria-label={`React with ${emoji}`}
            title={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    </>
  );
}
