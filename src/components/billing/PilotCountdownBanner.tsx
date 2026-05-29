// =============================================================================
// PilotCountdownBanner
//
// Small in-app banner for users on the Protocol Clarity Pilot. Shows
// "Pilot — N days left" while active, "Pilot expires today" the day-of,
// and a stronger "Pilot expired — upgrade to keep your work" once past.
//
// CTAs convert to the Workspace ($59/mo) plan. The gate on the pilot
// expiry itself is frontend-only — see plan.md note on server-side
// enforcement (decision B).
// =============================================================================

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useCheckout } from '../../hooks/useCheckout';
import { useAuth } from '../../context/AuthContext';
import { useSubscription } from '../../hooks/useSubscription';
import { useCheckoutRedirect } from '../../context/CheckoutRedirectContext';
import { pilotStatus, pilotDaysRemaining } from '../../lib/entitlements';
import { findProductByKind } from '../../stripe-config';

export default function PilotCountdownBanner() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { subscription } = useSubscription();
  const { createCheckoutSession } = useCheckout();
  const { session } = useAuth();
  const { setRedirecting } = useCheckoutRedirect();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = pilotStatus(subscription);
  if (status === 'none') return null;
  const daysLeft = pilotDaysRemaining(subscription);

  const upgrade = findProductByKind('workspace_monthly');

  const handleUpgrade = async () => {
    if (!upgrade || !session) return;
    setError(null);
    setPending(true);
    setRedirecting(true, 'Opening checkout…');
    try {
      await createCheckoutSession(
        upgrade.priceId,
        window.location.href,
        window.location.href,
        upgrade.mode === 'none' ? 'subscription' : upgrade.mode,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
      setPending(false);
      setRedirecting(false);
    }
  };

  // Tone scales with urgency. Active state was previously too subtle on the
  // light-mode page background (bg-[#F8FAFC]) — the 8% opacity background
  // visually blended in. Bumped to 18% bg + 50% border so the banner reads
  // as a clear notification without escalating to the amber 'warning' or
  // rose 'urgent' tones, which are reserved for expiring_soon and expired.
  const toneClass =
    status === 'expired'
      ? isLight
        ? 'bg-rose-50 border-rose-200 text-rose-700'
        : 'bg-rose-500/[0.06] border-rose-500/20 text-rose-300'
      : status === 'expiring_soon'
      ? isLight
        ? 'bg-amber-50 border-amber-200 text-amber-700'
        : 'bg-amber-500/[0.06] border-amber-500/20 text-amber-300'
      : isLight
      ? 'bg-[#017BC8]/[0.18] border-[#017BC8]/50 text-[#1a3d6f]'
      : 'bg-[#74B4DC]/20 border-[#74B4DC]/40 text-[#c8d8eb]';

  const label =
    status === 'expired'
      ? 'Pilot expired'
      : daysLeft === 0
      ? 'Pilot expires today'
      : daysLeft === 1
      ? '1 day left on your pilot'
      : `${daysLeft} days left on your pilot`;

  const desc =
    status === 'expired'
      ? 'Upgrade to a Workspace to keep your protocols and worksheets.'
      : 'Upgrade to a Workspace before your pilot ends to keep going.';

  const buttonClasses = isLight
    ? 'bg-[#017BC8] text-white hover:bg-[#0477BF]'
    : 'bg-[#74B4DC] text-[#0F172A] hover:bg-[#026BBE]';

  return (
    <div className={`${toneClass} border rounded-lg px-4 py-3 flex items-start gap-3`}>
      <Sparkles size={14} className="flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[12px] mt-0.5 opacity-80 leading-snug">{desc}</p>
      </div>
      <button
        type="button"
        onClick={handleUpgrade}
        disabled={pending || !upgrade}
        className={`flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonClasses}`}
      >
        {pending && <Loader2 size={12} className="animate-spin" />}
        Upgrade — $59 / month
      </button>
      {error && (
        <p className="mt-2 text-[11px] text-rose-600 basis-full">{error}</p>
      )}
    </div>
  );
}
