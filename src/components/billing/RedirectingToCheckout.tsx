// =============================================================================
// RedirectingToCheckout
//
// Full-screen "we're heading to Stripe" loading view. Renders only when
// `useCheckoutRedirect().isRedirecting` is true. App.tsx swaps the entire
// app out for this component so the user doesn't see the previous view
// linger while a Stripe Checkout / Portal call is in flight.
//
// Two pieces of copy are read from context: the headline ("Opening
// checkout…" by default; the caller can override with "Opening billing
// portal…" or similar) plus a fixed reassurance line.
// =============================================================================

import { Loader2 } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useCheckoutRedirect } from '../../context/CheckoutRedirectContext';

export default function RedirectingToCheckout() {
  const { theme } = useTheme();
  const { message } = useCheckoutRedirect();
  const isLight = theme === 'light';

  const pageBg = isLight ? 'bg-[#F8FAFC]' : 'bg-[#020617]';

  return (
    <div className={`min-h-screen ${pageBg} flex flex-col items-center justify-center px-4 relative overflow-hidden`}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isLight
            ? 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(1,123,200,0.08) 0%, transparent 65%)'
            : 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(1,123,200,0.14) 0%, transparent 65%)',
        }}
      />
      <div className="relative z-10 flex flex-col items-center">
        <div className="flex items-center gap-3">
          <Loader2 size={22} className="animate-spin text-[#017BC8]" />
          <span className="text-sm font-semibold text-fg-heading">
            {message}
          </span>
        </div>
        <p className="text-xs text-fg-sub mt-3 max-w-xs text-center leading-relaxed">
          You're being redirected to Stripe. Don't refresh — this should
          take a couple of seconds.
        </p>
      </div>
    </div>
  );
}
