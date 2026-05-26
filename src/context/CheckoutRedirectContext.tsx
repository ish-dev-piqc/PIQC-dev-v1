// =============================================================================
// CheckoutRedirectContext
//
// Shared "we're about to navigate to Stripe" flag. Any component that
// triggers a Stripe redirect (Pricing CTAs, Manage billing, PilotCountdown
// upgrade, Settings → Billing upgrade-from-pilot) calls `setRedirecting`
// before its fetch; App.tsx watches the flag and renders a full-screen
// <RedirectingToCheckout /> overlay in place of the normal app while it's
// true, so the user doesn't see the previous view linger or flash.
//
// `message` lets the caller tailor copy ("Opening checkout…" vs "Opening
// billing portal…"). Default is "Opening checkout…".
//
// Failure handling is the caller's responsibility: on a thrown error, the
// caller calls `setRedirecting(false)` and renders its own inline error.
// Success is detected implicitly — `window.location.href` navigates away
// and the component unmounts, so we don't need an explicit success signal.
// =============================================================================

import { createContext, useContext, useMemo, useState } from 'react';

interface CheckoutRedirectContextValue {
  isRedirecting: boolean;
  message: string;
  setRedirecting: (value: boolean, message?: string) => void;
}

const DEFAULT_MESSAGE = 'Opening checkout…';

const CheckoutRedirectContext = createContext<CheckoutRedirectContextValue>({
  isRedirecting: false,
  message: DEFAULT_MESSAGE,
  setRedirecting: () => {},
});

export function CheckoutRedirectProvider({ children }: { children: React.ReactNode }) {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);

  // Memoise the value object so consumers don't re-render on every parent
  // re-render. The two setters in the value depend only on setIsRedirecting /
  // setMessage which are stable from useState, but the wrapper function
  // identity would change every render without useMemo.
  const value = useMemo<CheckoutRedirectContextValue>(
    () => ({
      isRedirecting,
      message,
      setRedirecting: (value, msg) => {
        setIsRedirecting(value);
        setMessage(msg ?? DEFAULT_MESSAGE);
      },
    }),
    [isRedirecting, message],
  );

  return (
    <CheckoutRedirectContext.Provider value={value}>
      {children}
    </CheckoutRedirectContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCheckoutRedirect() {
  return useContext(CheckoutRedirectContext);
}
