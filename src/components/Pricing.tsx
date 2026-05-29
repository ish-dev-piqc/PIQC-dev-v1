import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCheckout } from '../hooks/useCheckout';
import { useSubscription } from '../hooks/useSubscription';
import { useCheckoutRedirect } from '../context/CheckoutRedirectContext';
import {
  findProductByKind,
  PRIMARY_PLAN_KINDS,
  ADDON_KINDS,
  type StripeProduct,
} from '../stripe-config';
import { setPendingCheckout } from '../lib/billing/pendingCheckout';
import { pilotStatus } from '../lib/entitlements';
import type { AppView } from '../App';

// =============================================================================
// Pricing — landing page section.
//
// Three primary cards (Pilot / Workspace / Annual) + add-on row + sales-led
// tile. CTA semantics per plan:
//
//   Pilot (one-time payment)
//     unauth     → login
//     auth       → Stripe checkout (mode=payment)
//     active sub → "You already have a workspace" → dashboard
//
//   Workspace monthly / annual (subscription)
//     unauth                       → login
//     auth + no active sub         → Stripe checkout (mode=subscription)
//     auth + active sub same plan  → "Current plan" → dashboard
//     auth + active sub other plan → "Switch plan" → checkout
//
//   Add-ons (subscription items appended to an existing subscription)
//     unauth or no active sub      → "Start a workspace first" → login/checkout
//     active sub                   → Stripe checkout that appends the addon
//
//   Enterprise — no Stripe; CTA → #contact anchor.
//
// On Stripe redirect back, the app's auth/subscription useEffect picks up the
// new state and sends the user to the dashboard.
// =============================================================================

interface PricingProps {
  onViewChange: (view: AppView) => void;
}

export default function Pricing({ onViewChange }: PricingProps) {
  const { theme } = useTheme();
  const { session } = useAuth();
  const { createCheckoutSession } = useCheckout();
  const { subscription, loading: subLoading } = useSubscription();
  const { setRedirecting } = useCheckoutRedirect();
  const isLight = theme === 'light';

  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasActiveSub =
    subscription?.status === 'active' || subscription?.status === 'trialing';
  // Block double-purchase of the Pilot. `pilotStatus` returns 'none' for
  // users with no pilot, otherwise 'active' / 'expiring_soon' / 'expired'.
  // We treat anything other than 'none' as "already has a pilot" — so the
  // CTA navigates to the dashboard instead of opening a second Checkout.
  // We deliberately include 'expired' in the block: a user who let their
  // pilot lapse shouldn't be sold ANOTHER $25 pilot; they should be funneled
  // to a Workspace upgrade instead.
  const hasPilot = pilotStatus(subscription) !== 'none';

  const primaryProducts = PRIMARY_PLAN_KINDS
    .map(findProductByKind)
    .filter((p): p is StripeProduct => !!p);
  const addonProducts = ADDON_KINDS
    .map(findProductByKind)
    .filter((p): p is StripeProduct => !!p);
  const enterprise = findProductByKind('enterprise');

  // Launch checkout for any product with a real priceId.
  //
  //   Pilot     → mode=payment, one-time Checkout
  //   Workspace → mode=subscription, recurring Checkout
  //   Add-on    → mode=subscription with append_to_subscription=true; the
  //               edge function appends to the user's active subscription
  //               as a Subscription Item (no Stripe redirect). If the user
  //               has no active subscription, we tell them to start a
  //               Workspace first.
  const launchCheckout = async (product: StripeProduct) => {
    if (product.mode === 'none') return;
    if (!session) {
      // Stash the intent so App.tsx + Pricing's auto-resume effect can pick
      // it up after the auth round trip and fire the checkout call without
      // the user having to click the CTA a second time.
      setPendingCheckout(product.kind);
      onViewChange('login');
      return;
    }

    const isAddon =
      product.kind === 'addon_protocol' || product.kind === 'addon_seats';
    if (isAddon && !hasActiveSub) {
      setError(
        'Start a Workspace before adding seats or protocols. Add-ons attach to an existing subscription.',
      );
      return;
    }

    setError(null);
    setPendingKind(product.kind);
    // Add-ons append to the active subscription without a Stripe redirect,
    // so we leave the full-screen loader off for those. Pilot + Workspace
    // both redirect to Stripe Checkout, so we flip the global flag and
    // App.tsx swaps the entire UI for <RedirectingToCheckout />.
    if (!isAddon) setRedirecting(true, 'Opening checkout…');
    try {
      // Vite serves this app under a base path (`/PIQC-dev-v1/` on GitHub
      // Pages). `window.location.origin` alone would point Stripe at the
      // GitHub Pages user-root and 404 on return. `import.meta.env.BASE_URL`
      // is the configured base ending in `/`, so origin + base = the app's
      // real public URL.
      const appUrl = window.location.origin + import.meta.env.BASE_URL;
      await createCheckoutSession(
        product.priceId,
        appUrl,
        `${appUrl}#pricing`,
        product.mode,
        { appendToSubscription: isAddon },
      );
      // If we get here, the redirect didn't happen — likely cancelled
      // (subscriptions/payment) or an append succeeded and we're staying
      // on-page (add-ons). For appends, refresh the subscription state.
      if (isAddon) {
        setPendingKind(null);
        window.location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setPendingKind(null);
      if (!isAddon) setRedirecting(false);
    }
  };

  const ctaLabelFor = (product: StripeProduct): string => {
    if (pendingKind === product.kind) return 'Redirecting…';
    if (product.mode === 'none') return product.ctaLabel;
    if (session && subLoading) return 'Loading…';
    if (!session) return product.ctaLabel;
    if (hasActiveSub && (product.kind === 'workspace_monthly' || product.kind === 'workspace_annual')) {
      return 'Go to dashboard';
    }
    // Already-piloting users see a dashboard-redirect label on the Pilot
    // card instead of "Start Pilot" so they don't accidentally re-charge.
    if (hasPilot && product.kind === 'pilot') {
      return 'Go to dashboard';
    }
    return product.ctaLabel;
  };

  const ctaActionFor = (product: StripeProduct) => () => {
    if (product.mode === 'none') {
      // Enterprise — scroll to contact form.
      const el = document.querySelector('#contact');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (hasActiveSub && (product.kind === 'workspace_monthly' || product.kind === 'workspace_annual')) {
      onViewChange('dashboard');
      return;
    }
    // Block second-purchase of the Pilot — see hasPilot comment above.
    if (hasPilot && product.kind === 'pilot') {
      onViewChange('dashboard');
      return;
    }
    void launchCheckout(product);
  };

  const ctaDisabledFor = (product: StripeProduct): boolean => {
    if (product.mode === 'none') return false;
    if (pendingKind && pendingKind !== product.kind) return true;
    if (session && subLoading) return true;
    return pendingKind === product.kind;
  };

  // -------------------------------------------------------------------------
  // Theme tokens
  // -------------------------------------------------------------------------
  const bg = isLight ? 'bg-[#F8FAFC]' : 'bg-[#020617]';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/[0.05]';
  const cardBg = isLight
    ? 'bg-white border-[#E2E8F0]'
    : 'bg-[#0F172A] border-white/[0.07]';
  const featuredCardBg = isLight
    ? 'bg-[#0F172A] border-[#0F172A]'
    : 'bg-[#017BC8]/20 border-[#017BC8]/40';
  const headingColor = 'text-fg-heading';
  const bodyColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';

  return (
    <section
      id="pricing"
      className={`py-24 px-4 sm:px-6 lg:px-8 ${bg} border-t ${border}`}
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-14">
          <p className="text-xs font-semibold text-[#74B4DC] uppercase tracking-widest mb-4">
            Pricing
          </p>
          <h2
            className={`text-3xl sm:text-4xl font-bold ${headingColor} leading-tight mb-4`}
          >
            Protocol clarity before execution.
          </h2>
          <p
            className={`text-[15px] ${bodyColor} leading-relaxed max-w-2xl mx-auto`}
          >
            PIQC helps clinical research sites turn complex protocols into
            structured, review-ready worksheets without starting from a blank
            page.
          </p>
          <p className={`text-[13px] ${mutedColor} mt-3 max-w-2xl mx-auto`}>
            Simple pricing. No token math. No credit tracking. No complicated
            AI usage meters.
          </p>
        </div>

        {/* Primary plan cards — Pilot / Monthly / Annual */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {primaryProducts.map((p) => {
            const isFeatured = p.badge === 'Recommended';
            const cardClasses = isFeatured ? featuredCardBg : cardBg;
            const titleTone = isFeatured
              ? isLight
                ? 'text-white/80'
                : 'text-[#CBD5E1]/70'
              : mutedColor;
            const priceTone = isFeatured ? 'text-white' : headingColor;
            const descTone = isFeatured
              ? isLight
                ? 'text-white/55'
                : 'text-[#CBD5E1]/50'
              : bodyColor;
            const featTone = isFeatured
              ? isLight
                ? 'text-white/75'
                : 'text-[#CBD5E1]/70'
              : bodyColor;
            const checkTone = isFeatured
              ? isLight
                ? 'text-[#74B4DC]'
                : 'text-[#7aafd4]'
              : 'text-[#74B4DC]';
            const buttonClasses = isFeatured
              ? isLight
                ? 'bg-white text-[#0F172A] hover:bg-[#F2F2F2]'
                : 'bg-white/[0.12] text-white hover:bg-white/[0.18] border border-white/[0.12]'
              : isLight
              ? 'bg-[#017BC8] text-white hover:bg-[#0477BF]'
              : 'bg-[#74B4DC] text-[#0F172A] hover:bg-[#026BBE]';

            return (
              <div
                key={p.kind}
                className={`${cardClasses} border rounded-2xl p-7 flex flex-col relative overflow-hidden`}
              >
                {isFeatured && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: isLight
                        ? 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(1,123,200,0.35) 0%, transparent 70%)'
                        : 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(1,123,200,0.25) 0%, transparent 70%)',
                    }}
                  />
                )}
                <div className="relative z-10 flex-1 flex flex-col">
                  <div className="mb-6">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span
                        className={`text-sm font-semibold ${titleTone} uppercase tracking-wider`}
                      >
                        {p.name}
                      </span>
                      {p.badge && (
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            isLight
                              ? 'bg-[#74B4DC]/30 text-[#d0dff0]'
                              : 'bg-[#74B4DC]/25 text-[#a8c0d8]'
                          }`}
                        >
                          {p.badge}
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-3">
                      <span className={`text-4xl font-bold ${priceTone}`}>
                        {p.priceDisplay}
                      </span>
                      <span
                        className={`text-sm ${
                          isFeatured
                            ? isLight
                              ? 'text-white/50'
                              : 'text-[#CBD5E1]/45'
                            : mutedColor
                        }`}
                      >
                        / {p.intervalDisplay}
                      </span>
                    </div>
                    <p className={`text-[13px] mt-2 ${descTone}`}>
                      {p.description}
                    </p>
                  </div>

                  <ul className="space-y-3 mb-8 flex-1">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5">
                        <Check
                          size={14}
                          className={`flex-shrink-0 mt-0.5 ${checkTone}`}
                          strokeWidth={2.5}
                        />
                        <span className={`text-[13px] leading-snug ${featTone}`}>
                          {f}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    onClick={ctaActionFor(p)}
                    disabled={ctaDisabledFor(p)}
                    className={`w-full py-3 px-5 text-sm font-semibold rounded-xl transition-all duration-200 inline-flex items-center justify-center gap-2 ${
                      ctaDisabledFor(p) ? 'opacity-60 cursor-not-allowed' : ''
                    } ${buttonClasses}`}
                  >
                    {pendingKind === p.kind && (
                      <Loader2 size={14} className="animate-spin" />
                    )}
                    {ctaLabelFor(p)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add-ons + sales-led tile */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
          {addonProducts.map((p) => (
            <div
              key={p.kind}
              className={`${cardBg} border rounded-xl px-5 py-4 flex flex-col`}
            >
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className={`text-[13px] font-semibold ${headingColor}`}>
                  {p.name}
                </span>
                <span className={`text-[15px] font-bold ${headingColor}`}>
                  {p.priceDisplay}
                </span>
              </div>
              <p className={`text-[12px] ${bodyColor} mb-3 leading-snug`}>
                {p.description}{' '}
                <span className={mutedColor}>· {p.intervalDisplay}</span>
              </p>
              <button
                type="button"
                onClick={ctaActionFor(p)}
                disabled={ctaDisabledFor(p)}
                className={`mt-auto inline-flex items-center justify-center gap-2 text-xs font-semibold px-3 py-2 rounded-md transition-colors ${
                  ctaDisabledFor(p)
                    ? 'opacity-60 cursor-not-allowed'
                    : ''
                } ${
                  isLight
                    ? 'border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                    : 'border border-white/[0.1] text-[#CBD5E1] hover:bg-white/[0.04]'
                }`}
              >
                {pendingKind === p.kind && (
                  <Loader2 size={12} className="animate-spin" />
                )}
                {ctaLabelFor(p)}
              </button>
            </div>
          ))}

          {/* Enterprise tile — sales-led */}
          {enterprise && (
            <div
              className={`${cardBg} border rounded-xl px-5 py-4 flex flex-col`}
            >
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className={`text-[13px] font-semibold ${headingColor}`}>
                  {enterprise.name}
                </span>
                <span className={`text-[15px] font-bold ${headingColor}`}>
                  {enterprise.priceDisplay}
                </span>
              </div>
              <p className={`text-[12px] ${bodyColor} mb-3 leading-snug`}>
                {enterprise.description}
              </p>
              <button
                type="button"
                onClick={ctaActionFor(enterprise)}
                className={`mt-auto inline-flex items-center justify-center gap-2 text-xs font-semibold px-3 py-2 rounded-md transition-colors ${
                  isLight
                    ? 'border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                    : 'border border-white/[0.1] text-[#CBD5E1] hover:bg-white/[0.04]'
                }`}
              >
                {enterprise.ctaLabel}
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-6 text-xs text-red-400 text-center">{error}</p>
        )}

        {/* Fine print */}
        <p className={`text-center text-xs ${mutedColor} mt-8 max-w-2xl mx-auto`}>
          Start with one protocol. See how PIQC helps your team move from
          manual protocol interpretation to review-ready operational
          worksheets.
        </p>
      </div>
    </section>
  );
}
