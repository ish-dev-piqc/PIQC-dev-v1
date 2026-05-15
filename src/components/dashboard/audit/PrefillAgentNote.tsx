import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// PrefillAgentNote — one-time agentic banner shown at the top of Stage 5
// after the auditor's deliverables were pre-filled from approved Stage 3 + 4.
//
// Visibility:
//   - Shown when any of the three deliverables carries a prefilled_at timestamp
//     AND the auditor hasn't dismissed the note for this audit yet
//   - Dismissal is persisted per-audit in localStorage so the note stays
//     dismissed across reloads but reappears for a different audit
//
// Tone:
//   - Calm, structured, declarative — names what happened in one short read
//   - "Drafts started from..." not "AI generated everything"
//   - The next-action signal is in the message, not a CTA button
// =============================================================================

const STORAGE_KEY_PREFIX = 'piq-stage5-prefill-note-dismissed:';

interface Props {
  auditId: string;
}

export default function PrefillAgentNote({ auditId }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const storageKey = `${STORAGE_KEY_PREFIX}${auditId}`;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      /* ignore — note re-renders next time but no infinite loop */
    }
    setDismissed(true);
  };

  return (
    <div
      data-testid="prefill-agent-note"
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
        isLight
          ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]'
          : 'bg-white/[0.04] border-white/10 text-[#d2d7e0]'
      }`}
    >
      <Sparkles
        size={14}
        className={`mt-0.5 flex-shrink-0 ${isLight ? 'text-[#4a6fa5]' : 'text-[#6e8fb5]'}`}
        aria-hidden
      />
      <p className="text-sm leading-relaxed flex-1 min-w-0">
        <span className="font-semibold">Drafts started.</span>{' '}
        These deliverables were pre-filled from your approved questionnaire and
        risk summary. Review and approve each before continuing.
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss this note"
        className={`inline-flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 ${
          isLight
            ? 'text-[#374152]/55 hover:text-[#1a1f28] hover:bg-white/60'
            : 'text-[#d2d7e0]/55 hover:text-white hover:bg-white/[0.06]'
        }`}
      >
        <X size={12} />
      </button>
    </div>
  );
}
