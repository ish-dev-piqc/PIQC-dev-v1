import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  appInfo: { name: 'Bolt Integration', version: '1.0.0' },
});

function corsResponse(body: object | null, status = 200) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
  if (status === 204) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return corsResponse({}, 204);
    if (req.method !== 'POST') return corsResponse({ error: 'Method not allowed' }, 405);

    const { return_url } = await req.json();
    if (!return_url || typeof return_url !== 'string') {
      return corsResponse({ error: 'Missing required parameter return_url' }, 400);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return corsResponse({ error: 'Missing authorization header' }, 401);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: getUserError } = await supabase.auth.getUser(token);
    if (getUserError || !user) return corsResponse({ error: 'Failed to authenticate user' }, 401);

    const { data: customer, error: getCustomerError } = await supabase
      .from('stripe_customers')
      .select('customer_id')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (getCustomerError) {
      console.error('Failed to fetch customer:', getCustomerError);
      return corsResponse({ error: 'Failed to fetch customer information' }, 500);
    }
    if (!customer?.customer_id) {
      return corsResponse({ error: 'No billing account found for this user' }, 404);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.customer_id,
      return_url,
    });

    return corsResponse({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Portal error: ${message}`);
    return corsResponse({ error: message }, 500);
  }
});
