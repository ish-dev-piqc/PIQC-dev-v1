import { useAuth } from '../contexts/AuthContext'

export function useCheckout() {
  const { session } = useAuth()

  const createCheckoutSession = async (
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    mode: 'payment' | 'subscription'
  ) => {
    if (!session?.access_token) {
      throw new Error('No authentication token available')
    }

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        price_id: priceId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        mode,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to create checkout session')
    }

    const { url } = await response.json()
    
    if (url) {
      window.location.href = url
    } else {
      throw new Error('No checkout URL received')
    }
  }

  return { createCheckoutSession }
}