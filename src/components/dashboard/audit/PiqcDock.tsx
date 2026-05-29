import PiqcMark from './PiqcMark';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// PiqcDock — persistent bottom-right affordance to summon PIQC.
//
// The shoulder. Always visible while the auditor works inside an audit;
// hides only when the chat panel is already open (z-30 vs the panel's
// z-40 — the panel covers it anyway, but explicit hidden = no visual
// fight during the slide-over animation).
//
// Why a dock, not a header button:
//   - The original "Ask" header button buried PIQC in the chrome row.
//     Auditors had to learn another header control to find help.
//   - The dock sits where the eye rests after writing — bottom of the
//     workspace, opposite the StageNav rail. It's the agentic equivalent
//     of "I'm here when you need me."
//   - One summon path. Removing the header button was a deliberate
//     cognitive-load collapse, not an oversight.
//
// Affordance shape:
//   - Pill (icon + label) rather than a bare floating action button —
//     "Ask PIQC" is the brand-naming moment and it shouldn't hide
//     behind an unlabeled icon. First-time users see the label,
//     repeat users skim past it.
//   - Soft shadow + brand-tinted border so the dock reads as floating
//     above the workspace, not pinned to it.
//   - 44px minimum touch target on the icon side (hit area), label
//     extends the surface horizontally without changing tap reach.
//
// Behavior intentionally NOT in this PR (decision-debt):
//   - Notification dot when PIQC has something proactive to surface
//     (e.g., "you have unreviewed SOTR items relevant to this stage").
//     That belongs in a future "ambient signals" PR.
//   - Inline expansion (dock → mini-thread inline, no full drawer).
//     The drawer stays the focused surface for now.
// =============================================================================

interface Props {
  onOpen: () => void;
  /** When true, the dock is unmounted from view — the chat panel is taking
   *  its place. Kept as a prop (rather than read from a context) so this
   *  component stays trivially testable. */
  hidden: boolean;
  /** When true, render a subtle amber dot on the dock mark to signal that
   *  PIQC has noticed something the auditor may want to look at. The dot
   *  carries NO count — count + detail live inside the panel. The dock
   *  signals presence-of-attention, not magnitude-of-attention. */
  hasSignals?: boolean;
}

export default function PiqcDock({ onOpen, hidden, hasSignals = false }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  if (hidden) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="piqc-dock"
      aria-label={
        hasSignals
          ? 'Ask PIQC — open the audit assistant. PIQC has noticed something worth a look.'
          : 'Ask PIQC — open the audit assistant'
      }
      /* Pronunciation cue lives in the hover layer. PIQC is unrecoverable
         as "pixie" in writing without it, and the dock is the auditor's
         first encounter with the name. Title also mirrors the signal state
         so the hover-only "what's the dot" answer is right there. */
      title={
        hasSignals
          ? "Ask PIQC (pronounced 'pixie') — PIQC noticed something worth a look"
          : "Ask PIQC (pronounced 'pixie') — open the audit assistant"
      }
      className={[
        // Position: bottom-right, comfortable inset from edges. z-30 so the
        // z-40 chat panel always wins when it opens; z-50 SOTR per-item
        // drawers also stack above us correctly.
        'fixed bottom-5 right-5 z-30',
        'inline-flex items-center gap-2 pl-3 pr-4 py-2.5',
        'rounded-full text-sm font-medium',
        'transition-all duration-150 ease-out',
        // Brand treatment: PIQC gets its own color register, distinct from
        // the workspace's neutral chrome. Warmer in light mode, lifted
        // panel-on-panel feel in dark.
        isLight
          ? 'bg-white border border-[#02BBB8]/25 text-[#334155] shadow-[0_8px_24px_-8px_rgba(2,187,184,0.35)] hover:shadow-[0_12px_32px_-8px_rgba(2,187,184,0.45)] hover:border-[#02BBB8]/40'
          : 'bg-[#0F172A] border border-[#02BBB8]/30 text-[#CBD5E1] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)] hover:border-[#02BBB8]/50',
        // Mark is brand-tinted; the label stays in the workspace's text
        // colour so it doesn't shout. Whimsy lives in the icon + shadow.
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02BBB8]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F8FAFC] dark:focus-visible:ring-offset-[#020617]',
      ].join(' ')}
    >
      <span
        data-testid="piqc-dock-mark"
        className={`relative inline-flex items-center justify-center w-7 h-7 rounded-full ${
          isLight
            ? 'bg-[#02BBB8]/10 text-[#02BBB8]'
            : 'bg-[#02BBB8]/15 text-[#6FC9C7]'
        }`}
      >
        <PiqcMark size={14} />
        {/* Signal dot — small amber pip at top-right of the mark badge.
            Amber = "attention without alarm" (mirrors the Protocol-source
            review-queue badge convention in AuditWorkspaceShell). The dot
            carries NO count; details + counts live inside the panel. The
            ring + soft glow help the dot read at small sizes without
            shouting. */}
        {hasSignals && (
          <span
            data-testid="piqc-dock-signal-dot"
            aria-hidden
            className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ${
              isLight
                ? 'bg-amber-500 ring-white'
                : 'bg-amber-400 ring-[#0F172A]'
            }`}
          />
        )}
      </span>
      <span>Ask PIQC</span>
    </button>
  );
}
