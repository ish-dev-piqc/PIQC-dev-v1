import { useState } from 'react'
import { stripeProducts } from '../stripe-config'
import { useCheckout } from '../hooks/useCheckout'
import { Alert } from '../components/Alert'

export function ProductsPage() {
  const [loadingProductId, setLoadingProductId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const { createCheckoutSession } = useCheckout()

  const handlePurchase = async (priceId: string, mode: 'payment' | 'subscription') => {
    setLoadingProductId(priceId)
    setError('')

    try {
      const successUrl = `${window.location.origin}/success`
      const cancelUrl = `${window.location.origin}/products`
      
      await createCheckoutSession(priceId, successUrl, cancelUrl, mode)
    } catch (err: any) {
      setError(err.message || 'Failed to create checkout session')
    } finally {
      setLoadingProductId(null)
    }
  }

  const formatPrice = (price: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(price)
  }

  return (
    <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Products</h1>
        
        {error && (
          <Alert variant="error" className="mb-6">
            {error}
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {stripeProducts.map((product) => (
            <div key={product.id} className="bg-white shadow rounded-lg overflow-hidden">
              <div className="p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {product.name}
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  {product.description}
                </p>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-2xl font-bold text-gray-900">
                    {formatPrice(product.price, product.currency)}
                  </span>
                  <span className="text-sm text-gray-500">
                    {product.mode === 'subscription' ? '/month' : 'one-time'}
                  </span>
                </div>
                <button
                  onClick={() => handlePurchase(product.priceId, product.mode)}
                  disabled={loadingProductId === product.priceId}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {loadingProductId === product.priceId ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Processing...
                    </>
                  ) : (
                    `${product.mode === 'subscription' ? 'Subscribe' : 'Buy Now'}`
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}