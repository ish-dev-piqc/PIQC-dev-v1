import { useState } from 'react';
import { ClipboardCheck, MessageSquare, Pencil, Smile, Trash2 } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import ReactionPicker from './ReactionPicker';

// =============================================================================
// MessageActions — hover-revealed action row to the side of a chat bubble.
// Replaces the previous single-icon MessagePromoteButton. Renders icons
// conditionally based on caller capability:
//
//   - Promote to decision  (always available)
//   - Edit                 (own message only, not soft-deleted)
//   - Delete               (own message, or admin-on-any; not soft-deleted)
//   - React                (not soft-deleted)
//
// Opens ReactionPicker inline when the smile icon is clicked.
// =============================================================================

interface MessageActionsProps {
  isSelf: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReact: boolean;
  /** True when the message can have a thread started on it (top-level
   *  message, not itself a reply, not soft-deleted). Hides the Reply icon
   *  when false. */
  canReply: boolean;
  onPromote: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
}

export default function MessageActions({
  isSelf,
  canEdit,
  canDelete,
  canReact,
  canReply,
  onPromote,
  onEdit,
  onDelete,
  onReact,
  onReply,
}: MessageActionsProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [pickerOpen, setPickerOpen] = useState(false);

  const positionClass = isSelf
    ? 'left-0 -translate-x-full pr-1'
    : 'right-0 translate-x-full pl-1';
  const buttonBase = `p-1 rounded ${
    isLight
      ? 'text-[#334155]/60 hover:bg-[#0F172A]/[0.06]'
      : 'text-[#CBD5E1]/60 hover:bg-white/[0.06]'
  }`;
  const borderClass = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const bgClass = isLight ? 'bg-white' : 'bg-[#0F172A]';

  return (
    <div
      className={`absolute z-10 top-1 ${positionClass} opacity-0 group-hover:opacity-100 focus-within:opacity-100`}
    >
      <div className={`flex items-center gap-0.5 rounded-md border shadow-sm px-0.5 py-0.5 ${borderClass} ${bgClass}`}>
        {canReply && (
          <button
            type="button"
            onClick={onReply}
            className={buttonBase}
            aria-label="Reply in thread"
            title="Reply in thread"
          >
            <MessageSquare size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={onPromote}
          className={buttonBase}
          aria-label="Promote to decision"
          title="Promote to decision"
        >
          <ClipboardCheck size={13} />
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className={buttonBase}
            aria-label="Edit message"
            title="Edit"
          >
            <Pencil size={13} />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className={`${buttonBase} ${isLight ? 'hover:text-rose-700' : 'hover:text-rose-300'}`}
            aria-label="Delete message"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        )}
        {canReact && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className={buttonBase}
              aria-label="Add reaction"
              title="React"
            >
              <Smile size={13} />
            </button>
            {pickerOpen && (
              <ReactionPicker
                anchor={isSelf ? 'right' : 'left'}
                onPick={onReact}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
