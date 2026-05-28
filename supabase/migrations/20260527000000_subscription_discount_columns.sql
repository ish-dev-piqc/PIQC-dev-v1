-- =============================================================================
-- Stripe — subscription-level discount denormalisation.
--
-- When a customer accepts a retention coupon during the Stripe Portal cancel
-- flow (e.g. "stay for 20% off your next 3 months"), Stripe applies it as a
-- subscription-level Discount. Their next invoice reflects the discounted
-- amount, but our Settings → Billing panel only showed the un-discounted base
-- price + add-on totals, which made customers confused when their actual
-- charge didn't match what the app implied.
--
-- The webhook now denormalises the active discount from
-- subscription.discount.coupon.percent_off and subscription.discount.end onto
-- stripe_subscriptions so the frontend can render "20% off through <date>"
-- without an extra Stripe API round trip.
--
-- Out of scope here: amount-based discounts (coupon.amount_off) and multiple
-- stacked discounts. Stripe Coupons support both but they're rare for SaaS
-- retention; if/when we add amount-off offers, extend the schema with
-- discount_amount_off + currency or move to a separate stripe_subscription_discounts
-- table.
-- =============================================================================

ALTER TABLE stripe_subscriptions
  ADD COLUMN discount_percent_off INT,
  ADD COLUMN discount_end TIMESTAMPTZ;

COMMENT ON COLUMN stripe_subscriptions.discount_percent_off IS
  'Percent-off value (e.g. 20 for 20%) of the active subscription-level '
  'discount, denormalised from Stripe via the webhook. Null when no '
  'discount is applied.';

COMMENT ON COLUMN stripe_subscriptions.discount_end IS
  'Timestamp when the active subscription-level discount expires. Null '
  'when no discount is applied OR the discount has no end (forever). '
  'Frontend should display "no end" when the column is null AND '
  'discount_percent_off is not null.';

-- Recreate the view to surface the new columns. WITH (security_invoker = true)
-- keeps RLS enforcement on the underlying tables, same as before.
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
    COALESCE(s.addon_protocols,  0) AS addon_protocols,
    s.discount_percent_off,
    s.discount_end
FROM stripe_customers c
LEFT JOIN stripe_subscriptions s ON c.customer_id = s.customer_id
WHERE c.user_id = auth.uid()
  AND c.deleted_at IS NULL
  AND (s.deleted_at IS NULL OR s.deleted_at IS NULL);

GRANT SELECT ON stripe_user_subscriptions TO authenticated;
