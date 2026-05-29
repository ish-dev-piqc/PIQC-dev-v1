import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// PrefillAgentNote — one-time agentic banner shown at the top of any stage
// where deliverables were pre-filled from approved upstream context.
//
// Reusable across stages: each caller passes a stage-scoped `storageKey` for
// per-(stage, audit) dismissal, plus the message text appropriate to that
// stage. Stage 5 (PR #58) and Stage 7 (Option E) are the two callers today.
//
// Visibility:
//   - Renders when the host decides a deliverable carries a prefilled_at
//     timestamp AND the auditor hasn't dismissed the note for this
//     (stage, audit) yet
//   - Dismissal is persisted in localStorage so the note stays dismissed
//     across reloads but reappears for a different audit / different stage
//
// Tone:
//   - Calm, structured, declarative — names what happened in one short read
//   - "Drafts started from..." not "AI generated everything"
//   - The next-action signal is in the message, not a CTA button
// =============================================================================

interface Props {
  /** localStorage key for dismissal state. Caller is responsible for making
   *  this unique per (stage, audit) so banners don't collide. */
  storageKey: string;
  /** The banner message body. Caller controls wording per stage. */
  message: React.ReactNode;
  /** Optional headline. Defaults to "Drafts started." */
  headline?: string;
}

export default function PrefillAgentNote({ storageKey, message, headline }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });

  // Re-sync the dismissed state when the storageKey changes. The initializer
  // above only runs on mount; without this, switching audits / stages keeps
  // the previous (stage, audit)'s dismissal state and shows a stale banner.
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey) === '1');
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

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
          ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]'
          : 'bg-white/[0.04] border-white/10 text-[#CBD5E1]'
      }`}
    >
      <Sparkles
        size={14}
        className={`mt-0.5 flex-shrink-0 ${isLight ? 'text-brand-600' : 'text-brand-300'}`}
        aria-hidden
      />
      <p className="text-sm leading-relaxed flex-1 min-w-0">
        <span className="font-semibold">{headline ?? 'Drafts started.'}</span>{' '}
        {message}
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss this note"
        className={`inline-flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 ${
          isLight
            ? 'text-[#334155]/55 hover:text-[#0F172A] hover:bg-white/60'
            : 'text-[#CBD5E1]/55 hover:text-white hover:bg-white/[0.06]'
        }`}
      >
        <X size={12} />
      </button>
    </div>
  );
}
