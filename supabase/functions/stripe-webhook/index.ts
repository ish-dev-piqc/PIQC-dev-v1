import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!;
const stripeWebhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const stripe = new Stripe(stripeSecret, {
  appInfo: {
    name: 'Bolt Integration',
    version: '1.0.0',
  },
});

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  try {
    // Handle OPTIONS request for CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // get the signature from the header
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return new Response('No signature found', { status: 400 });
    }

    // get the raw body
    const body = await req.text();

    // verify the webhook signature
    let event: Stripe.Event;

    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, stripeWebhookSecret);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Webhook signature verification failed: ${message}`);
      return new Response(`Webhook signature verification failed: ${message}`, { status: 400 });
    }

    EdgeRuntime.waitUntil(handleEvent(event));

    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error processing webhook:', error);
    return Response.json({ error: message }, { status: 500 });
  }
});

async function handleEvent(event: Stripe.Event) {
  const stripeData = event?.data?.object ?? {};

  if (!stripeData) {
    return;
  }

  if (!('customer' in stripeData)) {
    return;
  }

  // for one time payments, we only listen for the checkout.session.completed event
  if (event.type === 'payment_intent.succeeded' && event.data.object.invoice === null) {
    return;
  }

  const { customer: customerId } = stripeData;

  if (!customerId || typeof customerId !== 'string') {
    console.error(`No customer received on event: ${JSON.stringify(event)}`);
  } else {
    let isSubscription = true;

    if (event.type === 'checkout.session.completed') {
      const { mode } = stripeData as Stripe.Checkout.Session;

      isSubscription = mode === 'subscription';

      console.info(`Processing ${isSubscription ? 'subscription' : 'one-time payment'} checkout session`);
    }

    const { mode, payment_status } = stripeData as Stripe.Checkout.Session;

    if (isSubscription) {
      console.info(`Starting subscription sync for customer: ${customerId}`);
      await syncCustomerFromStripe(customerId);
    } else if (mode === 'payment' && payment_status === 'paid') {
      try {
        // Extract the necessary information from the session
        const {
          id: checkout_session_id,
          payment_intent,
          amount_subtotal,
          amount_total,
          currency,
        } = stripeData as Stripe.Checkout.Session;

        // Insert the order into the stripe_orders table
        const { error: orderError } = await supabase.from('stripe_orders').insert({
          checkout_session_id,
          payment_intent_id: payment_intent,
          customer_id: customerId,
          amount_subtotal,
          amount_total,
          currency,
          payment_status,
          status: 'completed', // assuming we want to mark it as completed since payment is successful
        });

        if (orderError) {
          console.error('Error inserting order:', orderError);
          return;
        }
        console.info(`Successfully processed one-time payment for session: ${checkout_session_id}`);

        // -----------------------------------------------------------------
        // Pilot expiry — for the Protocol Clarity Pilot ($25 one-time / 30
        // days), set pilot_expires_at on the customer row so the frontend
        // can display "Pilot — N days left" and gate the upgrade prompt.
        //
        // We detect the pilot via Stripe Price metadata.kind = 'pilot'.
        // pilot_days is read from the same metadata (fallback 30).
        // -----------------------------------------------------------------
        try {
          const session = await stripe.checkout.sessions.retrieve(checkout_session_id, {
            expand: ['line_items.data.price'],
          });
          const item = session.line_items?.data?.[0];
          const price = item?.price;
          const meta = (price?.metadata ?? {}) as Record<string, string | undefined>;
          if (meta.kind === 'pilot') {
            const pilotDays = Number(meta.pilot_days ?? '30');
            const expiresAt = new Date(
              Date.now() + (Number.isFinite(pilotDays) ? pilotDays : 30) * 24 * 60 * 60 * 1000,
            ).toISOString();
            const { error: pilotErr } = await supabase
              .from('stripe_customers')
              .update({ pilot_expires_at: expiresAt })
              .eq('customer_id', customerId);
            if (pilotErr) {
              console.error('Error setting pilot_expires_at:', pilotErr);
            } else {
              console.info(`Set pilot_expires_at=${expiresAt} for customer ${customerId}`);
            }
          }
        } catch (e) {
          console.error('Pilot expiry post-processing failed:', e);
        }
      } catch (error) {
        console.error('Error processing one-time payment:', error);
      }
    }
  }
}

// based on the excellent https://github.com/t3dotgg/stripe-recommendations
async function syncCustomerFromStripe(customerId: string) {
  try {
    // fetch latest subscription data from Stripe
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 1,
      status: 'all',
      expand: ['data.default_payment_method'],
    });

    // TODO verify if needed
    if (subscriptions.data.length === 0) {
      console.info(`No active subscriptions found for customer: ${customerId}`);
      const { error: noSubError } = await supabase.from('stripe_subscriptions').upsert(
        {
          customer_id: customerId,
          subscription_status: 'not_started',
        },
        {
          onConflict: 'customer_id',
        },
      );

      if (noSubError) {
        console.error('Error updating subscription status:', noSubError);
        throw new Error('Failed to update subscription status in database');
      }
    }

    // assumes that a customer can only have a single subscription
    const subscription = subscriptions.data[0];

    // -----------------------------------------------------------------
    // Identify the base plan item vs add-on items by Price metadata.kind.
    // Base items: 'workspace_monthly' | 'workspace_annual'
    // Add-on items: 'addon_protocol' | 'addon_seats'
    //
    // For add-ons, the quantity on each subscription item represents how
    // many packs / protocols the customer has bought. We sum quantities
    // across items of the same kind so the denormalised counts reflect
    // the user's true entitlement.
    // -----------------------------------------------------------------
    let basePriceId = subscription.items.data[0].price.id;
    let addonProtocols = 0;
    let addonSeatPacks = 0;
    for (const item of subscription.items.data) {
      const kind = (item.price.metadata as Record<string, string | undefined>)?.kind;
      const qty = item.quantity ?? 1;
      if (kind === 'addon_protocol') {
        addonProtocols += qty;
      } else if (kind === 'addon_seats') {
        addonSeatPacks += qty;
      } else if (kind === 'workspace_monthly' || kind === 'workspace_annual') {
        // Prefer the explicit base item if metadata is present.
        basePriceId = item.price.id;
      }
    }

    // -----------------------------------------------------------------
    // Subscription-level discount (e.g. retention coupon "20% off 3
    // months" accepted during Portal cancel flow). Denormalised onto
    // stripe_subscriptions so the frontend can show "20% off through
    // <date>" without re-fetching from Stripe. Only percent-off
    // discounts are surfaced today; amount-off and stacked discounts
    // are tracked as a backlog item in the plan MD.
    //
    // `subscription.discount` is Stripe's legacy single-discount field;
    // it's still populated when only one discount applies, which is
    // the common case for retention coupons.
    // -----------------------------------------------------------------
    const discount = subscription.discount;
    const discountPercentOff =
      typeof discount?.coupon?.percent_off === 'number'
        ? Math.round(discount.coupon.percent_off)
        : null;
    const discountEnd =
      typeof discount?.end === 'number'
        ? new Date(discount.end * 1000).toISOString()
        : null;

    // store subscription state
    const { error: subError } = await supabase.from('stripe_subscriptions').upsert(
      {
        customer_id: customerId,
        subscription_id: subscription.id,
        price_id: basePriceId,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
        addon_seat_packs: addonSeatPacks,
        addon_protocols: addonProtocols,
        discount_percent_off: discountPercentOff,
        discount_end: discountEnd,
        ...(subscription.default_payment_method && typeof subscription.default_payment_method !== 'string'
          ? {
              payment_method_brand: subscription.default_payment_method.card?.brand ?? null,
              payment_method_last4: subscription.default_payment_method.card?.last4 ?? null,
            }
          : {}),
        status: subscription.status,
      },
      {
        onConflict: 'customer_id',
      },
    );

    if (subError) {
      console.error('Error syncing subscription:', subError);
      throw new Error('Failed to sync subscription in database');
    }
    console.info(`Successfully synced subscription for customer: ${customerId}`);
  } catch (error) {
    console.error(`Failed to sync subscription for customer ${customerId}:`, error);
    throw error;
  }
}