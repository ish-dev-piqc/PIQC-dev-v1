import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useDirty } from '../../../context/DirtyStateContext';

// =============================================================================
// InlineEditableText — click-to-edit free-text field.
//
// Display state: renders the current value, or the empty-state CTA if value
// is null/empty. Clicking either swaps for a textarea autofocus'd. Save with
// Cmd/Ctrl+Enter; cancel with Esc. Empty input saves as null.
//
// onSave is awaited so we can surface inline errors without losing typed
// text. Save success collapses back to display state.
// =============================================================================

interface InlineEditableTextProps {
  value: string | null | undefined;
  /** Placeholder shown inside the textarea. */
  placeholder?: string;
  /** Label shown when value is empty in display state — clickable CTA.
   *  Defaults to "Click to add". */
  emptyLabel?: string;
  /** Persist handler. Receives trimmed text or null when cleared. Should
   *  throw or return a rejected promise to surface an error inline. */
  onSave: (next: string | null) => Promise<void>;
  rows?: number;
  disabled?: boolean;
  /** Optional className for the display-mode text wrapper. */
  className?: string;
}

export default function InlineEditableText({
  value,
  placeholder = '',
  emptyLabel = 'Click to add',
  onSave,
  rows = 3,
  disabled = false,
  className = '',
}: InlineEditableTextProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Confirm-leave guard — register only when actively editing AND the
  // draft diverges from the saved value (typing something that would be
  // lost on a mode switch).
  const draftDiverges =
    editing && draft.trim() !== (value ?? '').trim() && draft.trim().length > 0;
  useDirty(
    `Inline edit (${emptyLabel || 'note'})`,
    draftDiverges,
  );

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    if (disabled) return;
    setDraft(value ?? '');
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft('');
    setError(null);
  };

  const save = async () => {
    const trimmed = draft.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    // Skip the network call when nothing actually changed.
    if ((next ?? '') === (value ?? '')) {
      cancelEdit();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          disabled={saving}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
          className={`w-full text-sm rounded-md border px-2 py-1.5 leading-relaxed ${
            isLight
              ? 'bg-white border-[#E2E8F0] text-[#0F172A]'
              : 'bg-[#1E293B] border-white/10 text-white'
          } focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
        />
        {error && (
          <p className={`text-[11px] ${isLight ? 'text-rose-700' : 'text-rose-300'}`}>
            {error}
          </p>
        )}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md ${
              isLight
                ? 'bg-brand-600 text-white hover:bg-brand-700'
                : 'bg-brand-500 text-white hover:bg-brand-400'
            } disabled:opacity-50`}
          >
            <Check size={11} />
            Save
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={saving}
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md ${
              isLight
                ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]'
                : 'text-[#CBD5E1]/70 hover:bg-white/[0.05]'
            }`}
          >
            <X size={11} />
            Cancel
          </button>
          <span className={`${isLight ? 'text-[#334155]/50' : 'text-[#CBD5E1]/40'} text-[10px] ml-auto`}>
            ⌘+Enter to save · Esc to cancel
          </span>
        </div>
      </div>
    );
  }

  // Display state — render the value or an empty-state CTA. Either way,
  // clicking opens the editor (unless disabled).
  const hasValue = !!(value && value.trim().length > 0);
  return (
    <button
      type="button"
      onClick={startEdit}
      disabled={disabled}
      className={`group block w-full text-left ${
        disabled ? 'cursor-default' : 'cursor-text'
      } ${className}`}
    >
      {hasValue ? (
        <span
          className={`text-sm leading-relaxed whitespace-pre-wrap ${
            isLight ? 'text-[#0F172A]' : 'text-[#E2E8F0]'
          } ${
            disabled
              ? ''
              : isLight
                ? 'group-hover:bg-amber-50/40'
                : 'group-hover:bg-white/[0.03]'
          } rounded px-1 -mx-1`}
        >
          {value}
        </span>
      ) : (
        <span
          className={`inline-flex items-center gap-1 text-xs italic ${
            isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'
          } ${
            disabled
              ? ''
              : isLight
                ? 'group-hover:text-[#0F172A]'
                : 'group-hover:text-white'
          }`}
        >
          {!disabled && <Pencil size={11} />}
          {emptyLabel}
        </span>
      )}
    </button>
  );
}
