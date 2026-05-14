import { useAuth } from '../context/AuthContext';

interface CheckoutOptions {
  // When true, the edge function appends the price as a subscription item
  // on the user's existing active subscription instead of creating a new
  // Checkout Session. Used for the Additional Protocol and Additional Seat
  // Pack add-ons. There's no Stripe redirect — the user stays on-page and
  // Stripe prorates the charge against their existing card.
  appendToSubscription?: boolean;
}

export function useCheckout() {
  const { session } = useAuth();

  const createCheckoutSession = async (
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    mode: 'payment' | 'subscription',
    options: CheckoutOptions = {},
  ) => {
    if (!session?.access_token) {
      throw new Error('No authentication token available');
    }

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        price_id: priceId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        mode,
        append_to_subscription: options.appendToSubscription ?? false,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to create checkout session');
    }

    const data = await response.json();

    // For appended add-ons: backend returns { appended: true, url: successUrl }.
    // For Checkout: backend returns { sessionId, url } and we redirect.
    if (data.appended) {
      // Stay on-page; caller refreshes subscription state from the success_url.
      if (data.url) {
        window.location.href = data.url;
      }
      return;
    }

    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error('No checkout URL received');
    }
  };

  return { createCheckoutSession };
}
