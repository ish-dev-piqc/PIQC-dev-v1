import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { stripeProducts } from '../stripe-config'

interface Subscription {
  status: string
  planName: string
  currentPeriodEnd?: string
}

export function useSubscription() {
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)
  const { user } = useAuth()

  useEffect(() => {
    if (!user) {
      setSubscription(null)
      setLoading(false)
      return
    }

    const fetchSubscription = async () => {
      try {
        const { data, error } = await supabase
          .from('stripe_user_subscriptions')
          .select('*')
          .maybeSingle()

        if (error) {
          console.error('Error fetching subscription:', error)
          setSubscription(null)
        } else if (data) {
          const product = stripeProducts.find(p => p.priceId === data.price_id)
          const planName = product?.name || 'Unknown Plan'
          
          setSubscription({
            status: data.subscription_status,
            planName,
            currentPeriodEnd: data.current_period_end 
              ? new Date(data.current_period_end * 1000).toLocaleDateString()
              : undefined
          })
        } else {
          setSubscription(null)
        }
      } catch (error) {
        console.error('Error fetching subscription:', error)
        setSubscription(null)
      } finally {
        setLoading(false)
      }
    }

    fetchSubscription()
  }, [user])

  return { subscription, loading }
}