import { useAuth } from '../context/AuthContext';

export function usePortal() {
  const { session } = useAuth();

  const openPortal = async (returnUrl: string) => {
    if (!session?.access_token) {
      throw new Error('No authentication token available');
    }

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-portal`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ return_url: returnUrl }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to open billing portal');
    }

    const { url } = await response.json();

    if (url) {
      window.location.href = url;
    } else {
      throw new Error('No portal URL received');
    }
  };

  return { openPortal };
}
