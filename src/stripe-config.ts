// =============================================================================
// Stripe product catalog — single source of truth for the Pricing page,
// checkout invocation, and the entitlements calculator.
//
// Each entry pairs a Stripe priceId with customer-facing copy and the grant
// metadata our app needs to compute included/addon counts. The `kind`
// discriminator is what `stripe-webhook` reads back from the Stripe Price's
// metadata.kind to classify subscription items (base vs addon).
//
// TEST MODE priceIds are pasted below. When we switch to live, these need
// to be replaced with the live-mode priceIds (or read from env per-env).
// =============================================================================

export type PlanKind =
  | 'pilot'              // $25 one-time, 30 days
  | 'workspace_monthly'  // $59/mo
  | 'workspace_annual'   // $599/yr
  | 'addon_protocol'     // $29/mo per protocol (quantity multiplies)
  | 'addon_seats'        // $19/mo per 5-user pack (quantity multiplies)
  | 'enterprise';        // sales-led; no Stripe product

export type BillingInterval = 'one_time' | 'month' | 'year' | 'custom';

export interface StripeProduct {
  kind: PlanKind;
  // Empty string for the enterprise tile (no checkout).
  priceId: string;
  // Empty string for enterprise.
  productId: string;
  // Customer-facing label.
  name: string;
  // Short customer-facing description.
  description: string;
  // Currency-formatted price string for display ("$59" or "Custom").
  priceDisplay: string;
  // What's after the slash on the card ("month", "year", "30 days", "per protocol", etc.).
  intervalDisplay: string;
  // Stripe billing semantics.
  interval: BillingInterval;
  // Stripe checkout mode — payment for one-time, subscription for recurring.
  mode: 'payment' | 'subscription' | 'none';
  // CTA copy on the card.
  ctaLabel: string;
  // Optional callout ("Recommended", "Best value").
  badge?: string;
  // Bulleted features on the card.
  features: string[];
  // Entitlement grants — used by the entitlements calculator. Base plans
  // grant included* (absolute counts); add-ons grant grants* (per-unit,
  // multiplied by the subscription item quantity).
  includedUsers?: number;
  includedProtocols?: number;
  grantsUsersPerUnit?: number;
  grantsProtocolsPerUnit?: number;
  // Pilot only — duration in days from purchase.
  pilotDays?: number;
}

// -----------------------------------------------------------------------------
// Test-mode catalog. Replace priceIds + productIds when switching to live.
// -----------------------------------------------------------------------------

export const stripeProducts: StripeProduct[] = [
  // 1. Pilot — one-time, 30 days
  {
    kind: 'pilot',
    productId: 'prod_UbNBYdClCGsgcN',
    priceId: 'price_1TcARbHd6djFjQOn4R1Hjbxg',
    name: 'Protocol Clarity Pilot',
    description: 'Try PIQC with one protocol.',
    priceDisplay: '$25',
    intervalDisplay: '30 days',
    interval: 'one_time',
    mode: 'payment',
    ctaLabel: 'Start Pilot',
    features: [
      '1 protocol',
      'Up to 3 users',
      'Protocol parsing',
      'Review-ready worksheet generation',
      'Protocol-aware Q&A',
      'Export-ready worksheet package',
    ],
    includedUsers: 3,
    includedProtocols: 1,
    pilotDays: 30,
  },

  // 2. Workspace monthly
  {
    kind: 'workspace_monthly',
    productId: 'prod_UbNDp1LHK9wSe5',
    priceId: 'price_1TcASbHd6djFjQOnJK3XkDp8',
    name: 'Founding Site Workspace',
    description: 'For small clinical research site teams.',
    priceDisplay: '$59',
    intervalDisplay: 'month',
    interval: 'month',
    mode: 'subscription',
    ctaLabel: 'Start Workspace',
    badge: 'Recommended',
    features: [
      '5 users',
      '2 active protocols',
      'Protocol parsing',
      'Review-ready worksheet generation',
      'Protocol-aware Q&A',
      'Export-ready worksheet packages',
      'Human-in-the-loop review',
    ],
    includedUsers: 5,
    includedProtocols: 2,
  },

  // 3. Workspace annual
  {
    kind: 'workspace_annual',
    productId: 'prod_UbNDMEJG5KApMr',
    priceId: 'price_1TcAT9Hd6djFjQOnlnqlhW3y',
    name: 'Founding Site Annual',
    description: 'For teams that want simple annual access.',
    priceDisplay: '$599',
    intervalDisplay: 'year',
    interval: 'year',
    mode: 'subscription',
    ctaLabel: 'Start Annual Plan',
    badge: 'Best value',
    features: [
      '5 users',
      '2 active protocols',
      'Same features as monthly workspace',
      'Small annual discount',
    ],
    includedUsers: 5,
    includedProtocols: 2,
  },

  // 4. Add-on — additional protocol (recurring; quantity multiplies)
  {
    kind: 'addon_protocol',
    productId: 'prod_UbNEkYbHcN1JmL',
    priceId: 'price_1TcATwHd6djFjQOnXBm8XI8o',
    name: 'Additional Protocol',
    description: 'Add another active protocol to your workspace.',
    priceDisplay: '$29',
    intervalDisplay: 'month / protocol',
    interval: 'month',
    mode: 'subscription',
    ctaLabel: 'Add Protocol',
    features: [
      '+1 active protocol',
      'Protocol parsing',
      'Worksheet generation',
      'Protocol-aware Q&A',
      'Export-ready worksheet package',
    ],
    grantsProtocolsPerUnit: 1,
  },

  // 5. Add-on — seat pack (recurring; quantity multiplies)
  {
    kind: 'addon_seats',
    productId: 'prod_UbNFaL4j6hxjrf',
    priceId: 'price_1TcAUgHd6djFjQOnNGvAaUSu',
    name: 'Additional Seat Pack',
    description: 'Invite more coordinators, reviewers, or operations users.',
    priceDisplay: '$19',
    intervalDisplay: 'month / 5 seats',
    interval: 'month',
    mode: 'subscription',
    ctaLabel: 'Add Seats',
    features: ['+5 users'],
    grantsUsersPerUnit: 5,
  },

  // 6. Enterprise — no Stripe product, just a sales-led tile
  {
    kind: 'enterprise',
    productId: '',
    priceId: '',
    name: 'Site Network / SMO',
    description:
      'For site networks and SMOs managing multiple sites or higher protocol volume.',
    priceDisplay: 'Custom',
    intervalDisplay: '',
    interval: 'custom',
    mode: 'none',
    ctaLabel: 'Talk to PIQC',
    features: [
      'Custom users',
      'Custom protocols',
      'Admin support',
      'Onboarding',
      'Invoice options',
    ],
  },
];

// -----------------------------------------------------------------------------
// Lookup helpers
// -----------------------------------------------------------------------------

export function findProductByKind(kind: PlanKind): StripeProduct | undefined {
  return stripeProducts.find((p) => p.kind === kind);
}

export function findProductByPriceId(priceId: string): StripeProduct | undefined {
  return stripeProducts.find((p) => p.priceId === priceId);
}

// Cards rendered in the primary row of the pricing page (Pilot / Monthly / Annual).
export const PRIMARY_PLAN_KINDS: PlanKind[] = [
  'pilot',
  'workspace_monthly',
  'workspace_annual',
];

// Cards rendered in the add-on row.
export const ADDON_KINDS: PlanKind[] = ['addon_protocol', 'addon_seats'];
