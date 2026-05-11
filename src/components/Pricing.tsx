import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCheckout } from '../hooks/useCheckout';
import { useSubscription } from '../hooks/useSubscription';
import { stripeProducts } from '../stripe-config';
import type { AppView } from '../App';

// =============================================================================
// Pricing — landing page section.
//
// Three-state CTA:
//   unauthenticated          → send to login
//   auth + no active sub     → Stripe checkout
//   auth + active sub        → send to dashboard
// On Stripe redirect back the app's auth useEffect auto-sends to dashboard.
// =============================================================================

const STARTER_FEATURES = [
  'Site Mode — visit calendar, participants, team',
  'Audit Mode — complete 8-stage workflow',
  'Protocol-grounded AI assistant',
  'Markdown & Word (.docx) export',
  'Change history & audit trail',
];

const ENTERPRISE_FEATURES = [
  'Everything in Starter',
  'Multi-site & multi-protocol management',
  'Team delegation and compliance reports',
  'Priority support with SLA',
  'Custom onboarding and training',
  'Dedicated account manager',
];

interface PricingProps {
  onViewChange: (view: AppView) => void;
}

export default function Pricing({ onViewChange }: PricingProps) {
  const { theme } = useTheme();
  const { session } = useAuth();
  const { createCheckoutSession } = useCheckout();
  const { subscription, loading: subLoading } = useSubscription();
  const isLight = theme === 'light';

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const product = stripeProducts[0];
  const hasActiveSub =
    subscription?.status === 'active' || subscription?.status === 'trialing';

  const bg = isLight ? 'bg-[#f5f7fa]' : 'bg-[#0d1118]';
  const border = isLight ? 'border-[#e2e8ee]' : 'border-white/[0.05]';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#161d25] border-white/[0.07]';
  const featuredCardBg = isLight
    ? 'bg-[#1a1f28] border-[#1a1f28]'
    : 'bg-[#4a6fa5]/20 border-[#4a6fa5]/40';
  const headingColor = 'text-fg-heading';
  const bodyColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';

  const handleStarterCta = async () => {
    if (!session) {
      onViewChange('login');
      return;
    }
    if (hasActiveSub) {
      onViewChange('dashboard');
      return;
    }
    setCheckoutError(null);
    setCheckoutLoading(true);
    try {
      await createCheckoutSession(
        product.priceId,
        window.location.origin,
        `${window.location.origin}/#pricing`,
        product.mode,
      );
      // createCheckoutSession redirects; if it returns we're on the cancel path
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setCheckoutLoading(false);
    }
  };

  const ctaLabel = () => {
    if (checkoutLoading) return 'Redirecting…';
    if (session && subLoading) return 'Loading…';
    if (!session) return 'Get started';
    if (hasActiveSub) return 'Go to dashboard';
    return 'Subscribe';
  };

  const ctaDisabled = checkoutLoading || (!!session && subLoading);

  return (
    <section id="pricing" className={`py-24 px-4 sm:px-6 lg:px-8 ${bg} border-t ${border}`}>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-14">
          <p className="text-xs font-semibold text-[#6e8fb5] uppercase tracking-widest mb-4">
            Pricing
          </p>
          <h2 className={`text-3xl sm:text-4xl font-bold ${headingColor} leading-tight mb-4`}>
            Start with what you need
          </h2>
          <p className={`text-[15px] ${bodyColor} leading-relaxed max-w-xl mx-auto`}>
            One plan for individual auditors and site coordinators. Custom pricing for teams.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">

          {/* Starter */}
          <div className={`${featuredCardBg} border rounded-2xl p-7 flex flex-col relative overflow-hidden`}>
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: isLight
                  ? 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(74,111,165,0.35) 0%, transparent 70%)'
                  : 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(74,111,165,0.25) 0%, transparent 70%)',
              }}
            />
            <div className="relative z-10 flex-1 flex flex-col">
              <div className="mb-6">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={`text-sm font-semibold ${isLight ? 'text-white/80' : 'text-[#d2d7e0]/70'} uppercase tracking-wider`}>
                    {product.name}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isLight ? 'bg-[#6e8fb5]/30 text-[#d0dff0]' : 'bg-[#6e8fb5]/25 text-[#a8c0d8]'}`}>
                    Most popular
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5 mt-3">
                  <span className="text-4xl font-bold text-white">
                    ${product.price}
                  </span>
                  <span className={`text-sm ${isLight ? 'text-white/50' : 'text-[#d2d7e0]/45'}`}>/ month</span>
                </div>
                <p className={`text-[13px] mt-2 ${isLight ? 'text-white/55' : 'text-[#d2d7e0]/50'}`}>
                  {product.description}
                </p>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {STARTER_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check size={14} className={`flex-shrink-0 mt-0.5 ${isLight ? 'text-[#6e8fb5]' : 'text-[#7aafd4]'}`} strokeWidth={2.5} />
                    <span className={`text-[13px] leading-snug ${isLight ? 'text-white/75' : 'text-[#d2d7e0]/70'}`}>{f}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={handleStarterCta}
                disabled={ctaDisabled}
                className={`w-full py-3 px-5 text-sm font-semibold rounded-xl transition-all duration-200 inline-flex items-center justify-center gap-2 ${
                  ctaDisabled ? 'opacity-60 cursor-not-allowed' : ''
                } ${
                  isLight
                    ? 'bg-white text-[#1a1f28] hover:bg-[#f0f4f8]'
                    : 'bg-white/[0.12] text-white hover:bg-white/[0.18] border border-white/[0.12]'
                }`}
              >
                {checkoutLoading && <Loader2 size={14} className="animate-spin" />}
                {ctaLabel()}
              </button>

              {checkoutError && (
                <p className="mt-3 text-xs text-red-400 text-center">{checkoutError}</p>
              )}
            </div>
          </div>

          {/* Enterprise */}
          <div className={`${cardBg} border rounded-2xl p-7 flex flex-col`}>
            <div className="mb-6">
              <span className={`text-sm font-semibold ${mutedColor} uppercase tracking-wider`}>
                Enterprise
              </span>
              <div className="flex items-baseline gap-1.5 mt-3">
                <span className={`text-4xl font-bold ${headingColor}`}>Custom</span>
              </div>
              <p className={`text-[13px] mt-2 ${bodyColor}`}>
                For organizations running multiple protocols across sites.
              </p>
            </div>

            <ul className="space-y-3 mb-8 flex-1">
              {ENTERPRISE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check size={14} className="flex-shrink-0 mt-0.5 text-[#6e8fb5]" strokeWidth={2.5} />
                  <span className={`text-[13px] leading-snug ${bodyColor}`}>{f}</span>
                </li>
              ))}
            </ul>

            <a
              href="#contact"
              className={`w-full py-3 px-5 text-sm font-semibold rounded-xl text-center transition-all duration-200 border ${
                isLight
                  ? 'border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa] hover:border-[#c8d2dc]'
                  : 'border-white/[0.1] text-[#d2d7e0] hover:bg-white/[0.04]'
              }`}
            >
              Contact us
            </a>
          </div>
        </div>

        {/* Fine print */}
        <p className={`text-center text-xs ${mutedColor} mt-8`}>
          No setup fees. Cancel anytime.
        </p>
      </div>
    </section>
  );
}
