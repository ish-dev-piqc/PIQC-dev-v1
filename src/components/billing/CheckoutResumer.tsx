// =============================================================================
// CheckoutResumer
//
// Mounted by App.tsx when (a) a session exists and (b) a `pendingCheckout`
// intent was stashed in localStorage before the auth round trip. Reads the
// intent, fires `createCheckoutSession`, and lets the existing redirect in
// `useCheckout` navigate the browser to Stripe.
//
// Renders nothing visible — `<RedirectingToCheckout />` (rendered by
// App.tsx in parallel) owns the UI while this component does the work.
//
// Failure path: clears `pendingCheckout` before firing (so a transient
// error doesn't leave a stale intent to fire forever), then on a thrown
// error clears `isRedirecting` from the shared context. App.tsx falls
// through to the normal route on next render. We deliberately don't try
// to surface the error UI here because there's no obvious anchor — the
// originating Pricing page may not even be mounted. Logging to console is
// the best we can do until the user clicks again from a real surface.
// =============================================================================

import { useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCheckoutRedirect } from '../../context/CheckoutRedirectContext';
import { useCheckout } from '../../hooks/useCheckout';
import { useSubscription } from '../../hooks/useSubscription';
import {
  clearPendingCheckout,
  getPendingCheckout,
} from '../../lib/billing/pendingCheckout';
import { findProductByKind } from '../../stripe-config';

export default function CheckoutResumer() {
  const { session } = useAuth();
  const { subscription, loading: subLoading } = useSubscription();
  const { createCheckoutSession } = useCheckout();
  const { setRedirecting } = useCheckoutRedirect();

  // Fire at most once per mount. The effect's deps shift (subLoading, etc.)
  // could otherwise let it re-enter after window.location.href hasn't yet
  // navigated.
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (!session) return;
    if (subLoading) return;

    const kind = getPendingCheckout();
    if (!kind) return;

    const product = findProductByKind(kind);
    if (!product || product.mode === 'none') {
      clearPendingCheckout();
      setRedirecting(false);
      return;
    }

    // For add-ons we need an active sub to append to; if the user landed
    // here without one (rare race — they bought a Pilot in between), bail
    // gracefully rather than calling the edge function and getting a 400.
    const isAddon =
      product.kind === 'addon_protocol' || product.kind === 'addon_seats';
    const hasActiveSub =
      subscription?.status === 'active' || subscription?.status === 'trialing';
    if (isAddon && !hasActiveSub) {
      clearPendingCheckout();
      setRedirecting(false);
      return;
    }

    firedRef.current = true;
    clearPendingCheckout();
    setRedirecting(true, 'Opening checkout…');

    const appUrl = window.location.origin + import.meta.env.BASE_URL;
    void createCheckoutSession(
      product.priceId,
      appUrl,
      `${appUrl}#pricing`,
      product.mode,
      { appendToSubscription: isAddon },
    ).catch((err) => {
      // Stripe call failed — drop the loading state so the user can try
      // again from a real entry point.
      console.error('[CheckoutResumer] checkout session failed:', err);
      setRedirecting(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, subLoading, subscription?.status]);

  return null;
}
