-- =============================================================================
-- Stripe — pilot expiry + add-on item counts.
--
-- The new founder-launch pricing model adds three patterns the original
-- schema didn't cover:
--
--   1. The Pilot is a $25 one-time payment that grants 30 days of access.
--      Stripe records it as a row in `stripe_orders`. We need a single
--      `pilot_expires_at` we can read cheaply on every page load, so the
--      webhook denormalises it onto `stripe_customers`. (One pilot per
--      customer at a time; if they buy a second pilot we overwrite to the
--      newer expiry.)
--
--   2. Add-ons are appended to the base subscription as Stripe Subscription
--      Items. The webhook receives `customer.subscription.updated` and
--      recomputes the per-kind item counts, writing them onto
--      `stripe_subscriptions`. Frontend reads them via the view and the
--      entitlements helper uses them to allow / block invite-user and
--      add-protocol actions.
--
--   3. The existing `stripe_user_subscriptions` view returns only the base
--      plan's price_id. We extend it to surface `addon_seat_packs` +
--      `addon_protocols` so the frontend can do entitlement math without a
--      second round trip.
--
-- NOTE: the pilot expiry gate is currently frontend-only. A server-enforced
-- check on protected RPCs is queued — see plan.md "Server-side entitlement
-- enforcement (decision B)".
-- =============================================================================

ALTER TABLE stripe_customers
  ADD COLUMN pilot_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN stripe_customers.pilot_expires_at IS
  'Denormalised pilot end timestamp. Set by stripe-webhook on a successful '
  'one-time pilot checkout (created_at + N days from the price metadata). '
  'Null = no active pilot.';


ALTER TABLE stripe_subscriptions
  ADD COLUMN addon_seat_packs INT NOT NULL DEFAULT 0,
  ADD COLUMN addon_protocols  INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN stripe_subscriptions.addon_seat_packs IS
  'Count of $19 seat-pack add-on subscription items on this subscription. '
  'Each pack grants 5 users. Recomputed by stripe-webhook on every '
  'customer.subscription.updated event.';

COMMENT ON COLUMN stripe_subscriptions.addon_protocols IS
  'Count of $29 protocol add-on subscription items on this subscription. '
  'Each grants 1 active protocol. Recomputed by stripe-webhook on every '
  'customer.subscription.updated event.';


-- Recreate the view with the new columns surfaced. WITH (security_invoker)
-- means RLS on the underlying tables still enforces user scoping.
DROP VIEW IF EXISTS stripe_user_subscriptions;

CREATE VIEW stripe_user_subscriptions WITH (security_invoker = true) AS
SELECT
    c.customer_id,
    c.pilot_expires_at,
    s.subscription_id,
    s.status                AS subscription_status,
    s.price_id,
    s.current_period_start,
    s.current_period_end,
    s.cancel_at_period_end,
    s.payment_method_brand,
    s.payment_method_last4,
    COALESCE(s.addon_seat_packs, 0) AS addon_seat_packs,
    COALESCE(s.addon_protocols,  0) AS addon_protocols
FROM stripe_customers c
LEFT JOIN stripe_subscriptions s ON c.customer_id = s.customer_id
WHERE c.user_id = auth.uid()
  AND c.deleted_at IS NULL
  AND (s.deleted_at IS NULL OR s.deleted_at IS NULL);

GRANT SELECT ON stripe_user_subscriptions TO authenticated;
