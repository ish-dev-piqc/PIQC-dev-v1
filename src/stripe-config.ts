export interface StripeProduct {
  id: string
  priceId: string
  name: string
  description: string
  price: number
  currency: string
  mode: 'payment' | 'subscription'
}

export const stripeProducts: StripeProduct[] = [
  {
    id: 'prod_UN6GziN9qgl8VW',
    priceId: 'price_1TOM4OQsn1qRMC48Om8zRfgZ',
    name: 'PIQClinical',
    description: 'Access to protocol management platform',
    price: 10.00,
    currency: 'usd',
    mode: 'subscription'
  }
]