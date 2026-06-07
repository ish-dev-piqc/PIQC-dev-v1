import { CornerDownRight } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';

// =============================================================================
// ThreadReplyChip — slim "↳ N replies" chip under a top-level message bubble.
// Clicking opens the thread panel. Rendered only when count > 0.
// =============================================================================

interface ThreadReplyChipProps {
  count: number;
  /** ISO timestamp of the most recent reply — used for the "last reply Xh ago"
   *  label. Pass null/undefined to hide that suffix. */
  lastReplyAt?: string | null;
  isSelfMessage: boolean;
  onOpen: () => void;
}

function relativeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function ThreadReplyChip({
  count,
  lastReplyAt,
  isSelfMessage,
  onOpen,
}: ThreadReplyChipProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  if (count === 0) return null;

  const chipClass = isLight
    ? 'bg-[#F1F5F9] text-[#334155] border-[#E2E8F0] hover:bg-[#0F172A]/[0.04]'
    : 'bg-white/[0.04] text-[#CBD5E1] border-white/10 hover:bg-white/[0.07]';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium rounded-md border px-2 py-0.5 mt-1 ${chipClass} ${
        isSelfMessage ? 'self-end' : 'self-start'
      }`}
    >
      <CornerDownRight size={11} />
      {count} {count === 1 ? 'reply' : 'replies'}
      {lastReplyAt && (
        <span className={`${isLight ? 'text-[#334155]/60' : 'text-[#CBD5E1]/55'}`}>
          · last {relativeShort(lastReplyAt)}
        </span>
      )}
    </button>
  );
}
