// =============================================================================
// EntitlementGate
//
// Drop this around any action that should be capped by the user's plan
// (the invite-team-member form, the create-protocol form, etc.). Reads
// the supplied EntitlementDecision; renders children when allowed, or a
// soft blocker card with the right "Buy this add-on" CTA when not.
//
// Surfaces don't exist yet for invite-team or create-protocol — when they
// ship, wrap their submit button in this component. Today the component
// is unused; keeping it in the tree so the pattern is obvious.
// =============================================================================

import { Loader2, ShieldAlert } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useCheckout } from '../../hooks/useCheckout';
import { useAuth } from '../../context/AuthContext';
import { findProductByKind } from '../../stripe-config';
import type { EntitlementDecision } from '../../lib/entitlements';
import { useState } from 'react';

interface EntitlementGateProps {
  decision: EntitlementDecision;
  children: React.ReactNode;
}

export default function EntitlementGate({ decision, children }: EntitlementGateProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { createCheckoutSession } = useCheckout();
  const { session } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (decision.allowed) return <>{children}</>;

  const addon = decision.addonProductKind
    ? findProductByKind(decision.addonProductKind)
    : null;

  const handleUpgrade = async () => {
    if (!addon || !session) return;
    if (addon.mode === 'none') return;
    setError(null);
    setPending(true);
    try {
      await createCheckoutSession(
        addon.priceId,
        window.location.href,
        window.location.href,
        addon.mode,
        {
          appendToSubscription:
            addon.kind === 'addon_seats' || addon.kind === 'addon_protocol',
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
      setPending(false);
    }
  };

  const cardBg = isLight
    ? 'bg-amber-50 border-amber-200/80'
    : 'bg-amber-500/[0.06] border-amber-500/20';
  const buttonClasses = isLight
    ? 'bg-[#017BC8] text-white hover:bg-[#0477BF]'
    : 'bg-[#74B4DC] text-[#0F172A] hover:bg-[#026BBE]';

  return (
    <div className={`${cardBg} border rounded-lg p-4 flex items-start gap-3`}>
      <ShieldAlert size={16} className="flex-shrink-0 mt-0.5 text-amber-600" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-fg-heading font-medium">Plan limit reached</p>
        <p className="text-xs text-fg-sub mt-0.5 leading-relaxed">{decision.reason}</p>
        {addon && (
          <button
            type="button"
            onClick={handleUpgrade}
            disabled={pending}
            className={`mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonClasses}`}
          >
            {pending && <Loader2 size={12} className="animate-spin" />}
            {addon.ctaLabel} — {addon.priceDisplay} / {addon.intervalDisplay}
          </button>
        )}
        {error && <p className="mt-2 text-[11px] text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
