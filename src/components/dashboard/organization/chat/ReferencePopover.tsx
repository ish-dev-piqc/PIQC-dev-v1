import { useEffect } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useChatNavigation } from '../../../../context/ChatNavigationContext';

// =============================================================================
// ReferencePopover — small floating card shown when a participant / visit
// reference chip is clicked. Renders the resource's summary fields and
// (v2) a "Go to" button that cross-navigates to Site Mode's Visits or
// Participants tab and auto-opens the relevant drawer.
//
// Navigation handlers live in ChatNavigationContext (App.tsx provides
// them). The button is only enabled when the chip's data is resolved
// (i.e. the user already has the right protocol loaded — see
// ReferenceChip's `resolved` check).
// =============================================================================

export interface ReferencePopoverPayload {
  kind: 'participant' | 'visit';
  title: string;
  /** Raw id from the chat token — visit UUID or participant code/id.
   *  Used to deep-link into Site Mode via ChatNavigationContext. */
  refId: string;
  /** True when the referenced resource was found in the current
   *  protocol's loaded data. Controls whether "Go to" is enabled. */
  resolved: boolean;
  /** Label, value pairs. Empty label means a single full-width line (used for "not loaded" messages). */
  rows: Array<[string, string]>;
}

interface ReferencePopoverProps {
  payload: ReferencePopoverPayload;
  onClose: () => void;
}

export default function ReferencePopover({ payload, onClose }: ReferencePopoverProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { navigateToVisit, navigateToParticipant } = useChatNavigation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const labelColor = 'text-fg-label';
  const subColor = 'text-fg-sub';
  const headingColor = 'text-fg-heading';

  return (
    <>
      {/* Backdrop catcher — clicking outside closes the popover. Uses
          fixed positioning so it covers the viewport regardless of where
          the chip sits in the chat list. */}
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
      <div
        className={`absolute z-40 top-full left-0 mt-1 w-72 rounded-md border shadow-lg ${border} ${
          isLight ? 'bg-white' : 'bg-[#0F172A]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-3 py-2 border-b ${border} flex items-center justify-between gap-2`}>
          <p className={`${headingColor} text-xs font-semibold truncate`}>
            {payload.kind === 'visit' ? 'Visit' : 'Participant'} · {payload.title}
          </p>
          <button
            type="button"
            onClick={onClose}
            className={`p-0.5 rounded ${
              isLight
                ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]'
                : 'text-[#CBD5E1]/70 hover:bg-white/[0.05]'
            }`}
            aria-label="Close"
          >
            <X size={12} />
          </button>
        </div>
        <div className="px-3 py-2 space-y-1">
          {payload.rows.map(([label, value], idx) => (
            <div key={idx} className="flex items-start gap-2 text-[11px]">
              {label ? (
                <>
                  <p className={`${labelColor} uppercase tracking-wider font-semibold w-20 flex-shrink-0`}>
                    {label}
                  </p>
                  <p className={`${headingColor} flex-1 break-words`}>{value}</p>
                </>
              ) : (
                <p className={`${subColor} italic`}>{value}</p>
              )}
            </div>
          ))}
        </div>
        <div className={`px-3 py-2 border-t ${border}`}>
          <button
            type="button"
            disabled={!payload.resolved}
            onClick={() => {
              if (!payload.resolved) return;
              if (payload.kind === 'visit') navigateToVisit(payload.refId);
              else navigateToParticipant(payload.refId);
              onClose();
            }}
            className={`inline-flex items-center gap-1 text-[11px] ${
              payload.resolved
                ? `${headingColor} hover:opacity-70`
                : `${subColor} opacity-50 cursor-not-allowed`
            }`}
            title={
              payload.resolved
                ? `Open ${payload.kind} in Site Mode`
                : 'Resource not loaded — switch to its protocol first'
            }
          >
            <ExternalLink size={10} />
            Go to {payload.kind === 'visit' ? 'visit' : 'participant'}
          </button>
        </div>
      </div>
    </>
  );
}
