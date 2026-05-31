import { X, PartyPopper, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// InviteWelcomeBanner — sits below the Navbar for one render cycle after an
// invite token is accepted (or fails). Replaces the previous alert() popup
// per UX call: a coordinator handing the link off shouldn't subject the
// recipient to a native browser modal.
//
// Copy adapts to the outcome:
//   - role='admin'                          → "You're now a site administrator
//                                              of <org>. You have access to
//                                              every protocol the org owns."
//   - role='member' + protocol_count > 0    → "Welcome to <org>. You've been
//                                              added to N protocol(s) — open
//                                              one from the protocol picker."
//   - role='member' + protocol_count === 0  → "Welcome to <org>. No protocols
//                                              assigned yet — request access
//                                              from the protocol picker."
//   - error                                 → "Couldn't accept invite: <msg>"
// =============================================================================

export type InviteAcceptResult =
  | {
      ok: true;
      org_name: string;
      role: 'admin' | 'member';
      protocol_count: number;
    }
  | { ok: false; error: string };

interface InviteWelcomeBannerProps {
  result: InviteAcceptResult;
  onDismiss: () => void;
}

export default function InviteWelcomeBanner({ result, onDismiss }: InviteWelcomeBannerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  if (!result.ok) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={`w-full px-4 py-2 flex items-center justify-center gap-3 text-xs font-medium ${
          isLight
            ? 'bg-rose-500/10 border-b border-rose-500/30 text-rose-900'
            : 'bg-rose-500/15 border-b border-rose-400/30 text-rose-200'
        }`}
      >
        <AlertTriangle size={14} className="flex-shrink-0" />
        <span>
          <span className="font-semibold">Couldn't accept invite</span> — {result.error}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-rose-500/15 transition-colors"
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  const message =
    result.role === 'admin'
      ? `You're now a site administrator of ${result.org_name}. You have access to every protocol the org owns.`
      : result.protocol_count > 0
        ? `Welcome to ${result.org_name}. You've been added to ${result.protocol_count} protocol${
            result.protocol_count === 1 ? '' : 's'
          } — open one from the protocol picker above.`
        : `Welcome to ${result.org_name}. No protocols assigned yet — request access from the protocol picker above.`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full px-4 py-2 flex items-center justify-center gap-3 text-xs font-medium ${
        isLight
          ? 'bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-900'
          : 'bg-emerald-500/15 border-b border-emerald-400/30 text-emerald-200'
      }`}
    >
      <PartyPopper size={14} className="flex-shrink-0" />
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-emerald-500/15 transition-colors"
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
}
