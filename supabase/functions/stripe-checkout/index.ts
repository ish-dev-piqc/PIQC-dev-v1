import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!;
const stripe = new Stripe(stripeSecret, {
  appInfo: {
    name: 'Bolt Integration',
    version: '1.0.0',
  },
});

// =============================================================================
// Server-side price catalog (SEC-ebc361e PAY-1)
//
// Mirrors src/stripe-config.ts's self-serve entries. That file lives in the
// Vite frontend bundle and was never consulted here — this function accepted
// ANY price_id that existed in the Stripe account, so a caller could hit
// this edge function directly with an off-catalog price (legacy/test/wrong-
// flow price) and get a Checkout Session or a live subscription-item
// append for it. Enterprise/guest-seats/viewer-seats are intentionally
// absent (no self-serve priceId exists for them yet — see stripe-config.ts).
//
// Deno edge functions run in a separate deploy/runtime boundary from the
// Vite `src/` tree, so this is a duplicated, not shared, source of truth.
// If you add/change a self-serve product in src/stripe-config.ts, mirror it
// here too.
// =============================================================================
type CatalogEntry = { mode: 'payment' | 'subscription'; isAddon: boolean };

const PRICE_CATALOG: Record<string, CatalogEntry> = {
  'price_1TcARbHd6djFjQOn4R1Hjbxg': { mode: 'payment', isAddon: false },      // pilot
  'price_1TcASbHd6djFjQOnJK3XkDp8': { mode: 'subscription', isAddon: false }, // workspace_monthly
  'price_1TcAT9Hd6djFjQOnlnqlhW3y': { mode: 'subscription', isAddon: false }, // workspace_annual
  'price_1TcATwHd6djFjQOnXBm8XI8o': { mode: 'subscription', isAddon: true },  // addon_protocol
  'price_1TcAUgHd6djFjQOnNGvAaUSu': { mode: 'subscription', isAddon: true },  // addon_seats
};

// Helper function to create responses with CORS headers
function corsResponse(body: string | object | null, status = 200) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  // For 204 No Content, don't include Content-Type or body
  if (status === 204) {
    return new Response(null, { status, headers });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return corsResponse({}, 204);
    }

    if (req.method !== 'POST') {
      return corsResponse({ error: 'Method not allowed' }, 405);
    }

    const {
      price_id,
      success_url,
      cancel_url,
      mode,
      // Optional — when true and the user has an active subscription, we
      // append this price as a subscription item instead of starting a new
      // Checkout Session. Used for add-on flows (Additional Protocol /
      // Additional Seat Pack). No redirect needed; user's existing payment
      // method is charged prorated.
      append_to_subscription,
    } = await req.json();

    const error = validateParameters(
      { price_id, success_url, cancel_url, mode },
      {
        cancel_url: 'string',
        price_id: 'string',
        success_url: 'string',
        mode: { values: ['payment', 'subscription'] },
      },
    );

    if (error) {
      return corsResponse({ error }, 400);
    }

    // Reject any price_id not in our self-serve catalog before doing
    // anything with Stripe or the caller's subscription (SEC-ebc361e PAY-1).
    const catalogEntry = PRICE_CATALOG[price_id];
    if (!catalogEntry) {
      return corsResponse({ error: 'Unknown or unsupported price_id' }, 400);
    }
    if (catalogEntry.mode !== mode) {
      return corsResponse(
        { error: `price_id ${price_id} does not support mode '${mode}'` },
        400,
      );
    }
    if (append_to_subscription && !catalogEntry.isAddon) {
      return corsResponse(
        { error: 'append_to_subscription is only supported for add-on prices' },
        400,
      );
    }

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: getUserError,
    } = await supabase.auth.getUser(token);

    if (getUserError) {
      return corsResponse({ error: 'Failed to authenticate user' }, 401);
    }

    if (!user) {
      return corsResponse({ error: 'User not found' }, 404);
    }

    const { data: customer, error: getCustomerError } = await supabase
      .from('stripe_customers')
      .select('customer_id')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (getCustomerError) {
      console.error('Failed to fetch customer information from the database', getCustomerError);

      return corsResponse({ error: 'Failed to fetch customer information' }, 500);
    }

    let customerId;

    /**
     * In case we don't have a mapping yet, the customer does not exist and we need to create one.
     */
    if (!customer || !customer.customer_id) {
      const newCustomer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user.id,
        },
      });

      console.log(`Created new Stripe customer ${newCustomer.id} for user ${user.id}`);

      const { error: createCustomerError } = await supabase.from('stripe_customers').insert({
        user_id: user.id,
        customer_id: newCustomer.id,
      });

      if (createCustomerError) {
        console.error('Failed to save customer information in the database', createCustomerError);

        // Try to clean up both the Stripe customer and subscription record
        try {
          await stripe.customers.del(newCustomer.id);
          await supabase.from('stripe_subscriptions').delete().eq('customer_id', newCustomer.id);
        } catch (deleteError) {
          console.error('Failed to clean up after customer mapping error:', deleteError);
        }

        return corsResponse({ error: 'Failed to create customer mapping' }, 500);
      }

      if (mode === 'subscription') {
        const { error: createSubscriptionError } = await supabase.from('stripe_subscriptions').insert({
          customer_id: newCustomer.id,
          status: 'not_started',
        });

        if (createSubscriptionError) {
          console.error('Failed to save subscription in the database', createSubscriptionError);

          // Try to clean up the Stripe customer since we couldn't create the subscription
          try {
            await stripe.customers.del(newCustomer.id);
          } catch (deleteError) {
            console.error('Failed to delete Stripe customer after subscription creation error:', deleteError);
          }

          return corsResponse({ error: 'Unable to save the subscription in the database' }, 500);
        }
      }

      customerId = newCustomer.id;

      console.log(`Successfully set up new customer ${customerId} with subscription record`);
    } else {
      customerId = customer.customer_id;

      if (mode === 'subscription') {
        // Verify subscription exists for existing customer
        const { data: subscription, error: getSubscriptionError } = await supabase
          .from('stripe_subscriptions')
          .select('status')
          .eq('customer_id', customerId)
          .maybeSingle();

        if (getSubscriptionError) {
          console.error('Failed to fetch subscription information from the database', getSubscriptionError);

          return corsResponse({ error: 'Failed to fetch subscription information' }, 500);
        }

        if (!subscription) {
          // Create subscription record for existing customer if missing
          const { error: createSubscriptionError } = await supabase.from('stripe_subscriptions').insert({
            customer_id: customerId,
            status: 'not_started',
          });

          if (createSubscriptionError) {
            console.error('Failed to create subscription record for existing customer', createSubscriptionError);

            return corsResponse({ error: 'Failed to create subscription record for existing customer' }, 500);
          }
        }
      }
    }

    // Add-on append branch — no redirect, charges existing payment method.
    // Stripe will prorate the charge based on the current billing period.
    if (append_to_subscription && mode === 'subscription') {
      // Find the customer's active subscription from Stripe (authoritative).
      const stripeSubs = await stripe.subscriptions.list({
        customer: customerId,
        status: 'active',
        limit: 1,
      });
      const activeSub = stripeSubs.data[0];
      if (!activeSub) {
        return corsResponse(
          {
            error:
              'No active subscription. Start a Workspace before adding seats or protocols.',
          },
          400,
        );
      }

      // If an item with this exact price already exists, bump its quantity
      // instead of creating a duplicate item. Keeps the customer's invoice
      // tidy and the entitlement math straightforward.
      const existingItem = activeSub.items.data.find(
        (i) => i.price?.id === price_id,
      );
      if (existingItem) {
        await stripe.subscriptionItems.update(existingItem.id, {
          quantity: (existingItem.quantity ?? 1) + 1,
          proration_behavior: 'always_invoice',
        });
        console.log(
          `Bumped subscription item ${existingItem.id} to qty ${
            (existingItem.quantity ?? 1) + 1
          } on sub ${activeSub.id}`,
        );
      } else {
        await stripe.subscriptionItems.create({
          subscription: activeSub.id,
          price: price_id,
          quantity: 1,
          proration_behavior: 'always_invoice',
        });
        console.log(
          `Added new subscription item ${price_id} to sub ${activeSub.id}`,
        );
      }

      // Frontend should refresh subscription state after this returns.
      return corsResponse({ appended: true, url: success_url });
    }

    // create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: price_id,
          quantity: 1,
        },
      ],
      mode,
      success_url,
      cancel_url,
    });

    console.log(`Created checkout session ${session.id} for customer ${customerId}`);

    return corsResponse({ sessionId: session.id, url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Checkout error: ${message}`);
    return corsResponse({ error: message }, 500);
  }
});

type ExpectedType = 'string' | { values: string[] };
type Expectations<T> = { [K in keyof T]: ExpectedType };

function validateParameters<T extends Record<string, unknown>>(values: T, expected: Expectations<T>): string | undefined {
  for (const parameter in values) {
    const expectation = expected[parameter];
    const value = values[parameter];

    if (expectation === 'string') {
      if (value == null) {
        return `Missing required parameter ${parameter}`;
      }
      if (typeof value !== 'string') {
        return `Expected parameter ${parameter} to be a string got ${JSON.stringify(value)}`;
      }
    } else {
      if (!expectation.values.includes(value)) {
        return `Expected parameter ${parameter} to be one of ${expectation.values.join(', ')}`;
      }
    }
  }

  return undefined;
}