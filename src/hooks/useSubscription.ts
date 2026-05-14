import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  findProductByPriceId,
  type PlanKind,
  type BillingInterval,
} from '../stripe-config';

// =============================================================================
// useSubscription
//
// Returns a richer "what is this user on right now?" shape than just the raw
// Stripe row. Consumers (Pricing, Dashboard, entitlement gates) read:
//
//   kind                    'pilot' | 'workspace_monthly' | 'workspace_annual' | null
//   billingMode             'one_time' | 'month' | 'year' | null
//   planName                Display string ("Founding Site Workspace")
//   status                  Stripe subscription status ('active' | 'trialing' | …)
//                           For a paid pilot, derived as 'active' until pilot_expires_at,
//                           then 'pilot_expired'.
//   currentPeriodEnd        Pretty date for the next billing date (subs only).
//   pilotExpiresAt          ISO date when the one-time pilot access ends (pilot only).
//   includedUsers           Seats included in the base plan.
//   includedProtocols       Active protocols included in the base plan.
//   addonSeatPacks          Count of $19 add-on packs the user has bought.
//   addonProtocols          Count of $29 add-on protocols the user has bought.
//   totalUsers              includedUsers + 5 * addonSeatPacks
//   totalProtocols          includedProtocols + 1 * addonProtocols
//
// Add-on counts come from a future column on the workspace state (populated
// by stripe-webhook when subscription items change). Until that lands they
// read as 0 — the gate code still works, it just doesn't yet know the user
// has bought extras.
// =============================================================================

export interface Subscription {
  kind: PlanKind | null;
  billingMode: BillingInterval | null;
  planName: string;
  status: string;
  currentPeriodEnd?: string;
  pilotExpiresAt?: string;
  includedUsers: number;
  includedProtocols: number;
  addonSeatPacks: number;
  addonProtocols: number;
  totalUsers: number;
  totalProtocols: number;
}

const NULL_SUBSCRIPTION: Subscription = {
  kind: null,
  billingMode: null,
  planName: 'No plan',
  status: 'inactive',
  includedUsers: 0,
  includedProtocols: 0,
  addonSeatPacks: 0,
  addonProtocols: 0,
  totalUsers: 0,
  totalProtocols: 0,
};

export function useSubscription() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      setSubscription(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchSubscription = async () => {
      try {
        const { data, error } = await supabase
          .from('stripe_user_subscriptions')
          .select('*')
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          console.error('[useSubscription] fetch error:', error);
          setSubscription(NULL_SUBSCRIPTION);
          return;
        }
        if (!data) {
          setSubscription(NULL_SUBSCRIPTION);
          return;
        }

        const product = findProductByPriceId(data.price_id);
        const kind = product?.kind ?? (data.pilot_expires_at ? 'pilot' : null);
        const billingMode = product?.interval ?? (kind === 'pilot' ? 'one_time' : null);
        const planName = product?.name ?? (kind === 'pilot' ? 'Protocol Clarity Pilot' : 'Unknown plan');

        // Add-on counts are denormalised onto stripe_subscriptions by the
        // webhook on every customer.subscription.updated. Frontend reads
        // them through the view; entitlements helper uses them to gate
        // invite-user and add-protocol actions.
        const addonSeatPacks = typeof data.addon_seat_packs === 'number' ? data.addon_seat_packs : 0;
        const addonProtocols = typeof data.addon_protocols === 'number' ? data.addon_protocols : 0;

        // For the pilot, totalUsers / totalProtocols come from the catalog
        // entry's included counts (no add-ons apply). For workspace plans,
        // base + add-on grants are summed.
        const includedUsers = product?.includedUsers ?? (kind === 'pilot' ? 3 : 0);
        const includedProtocols = product?.includedProtocols ?? (kind === 'pilot' ? 1 : 0);

        // Pilot expiry — surfaced by the view from stripe_customers, set
        // by stripe-webhook when the one-time payment completes.
        const pilotExpiresAt: string | undefined = data.pilot_expires_at ?? undefined;

        setSubscription({
          kind,
          billingMode,
          planName,
          status: data.subscription_status ?? 'inactive',
          currentPeriodEnd: data.current_period_end
            ? new Date(data.current_period_end * 1000).toLocaleDateString()
            : undefined,
          pilotExpiresAt,
          includedUsers,
          includedProtocols,
          addonSeatPacks,
          addonProtocols,
          totalUsers: includedUsers + 5 * addonSeatPacks,
          totalProtocols: includedProtocols + 1 * addonProtocols,
        });
      } catch (e) {
        if (cancelled) return;
        console.error('[useSubscription] fetch error:', e);
        setSubscription(NULL_SUBSCRIPTION);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSubscription();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { subscription, loading };
}
