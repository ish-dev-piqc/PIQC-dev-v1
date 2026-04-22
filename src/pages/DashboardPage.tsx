import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../hooks/useSubscription'

export function DashboardPage() {
  const { user } = useAuth()
  const { subscription, loading } = useSubscription()

  return (
    <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        <div className="border-4 border-dashed border-gray-200 rounded-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            Welcome to your Dashboard
          </h1>
          
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Account Information</h2>
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                <span className="font-medium">Email:</span> {user?.email}
              </p>
              <p className="text-sm text-gray-600">
                <span className="font-medium">User ID:</span> {user?.id}
              </p>
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Subscription Status</h2>
            {loading ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                <span className="text-sm text-gray-600">Loading subscription...</span>
              </div>
            ) : subscription ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Plan:</span> {subscription.planName}
                </p>
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Status:</span> 
                  <span className={`ml-1 px-2 py-1 rounded-full text-xs ${
                    subscription.status === 'active' 
                      ? 'bg-blue-100 text-blue-800' 
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {subscription.status}
                  </span>
                </p>
                {subscription.currentPeriodEnd && (
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Next billing:</span> {subscription.currentPeriodEnd}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-600">No active subscription</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}