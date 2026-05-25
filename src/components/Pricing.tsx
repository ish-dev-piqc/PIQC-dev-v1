import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCheckout } from '../hooks/useCheckout';
import { useSubscription } from '../hooks/useSubscription';
import {
  findProductByKind,
  PRIMARY_PLAN_KINDS,
  ADDON_KINDS,
  type StripeProduct,
} from '../stripe-config';
import {
  clearPendingCheckout,
  getPendingCheckout,
  setPendingCheckout,
} from '../lib/billing/pendingCheckout';
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
  const isLight = theme === 'light';

  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasActiveSub =
    subscription?.status === 'active' || subscription?.status === 'trialing';

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
    try {
      await createCheckoutSession(
        product.priceId,
        window.location.origin,
        `${window.location.origin}/#pricing`,
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
    }
  };

  // Auto-resume a checkout the user started before signing in. Fires at most
  // once per mount — `resumedRef` guards against re-fire if the effect deps
  // shift (e.g. `subscription` repopulates after auth). We wait for
  // `subLoading` to settle so the add-on guard above evaluates against real
  // subscription state.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    if (!session || subLoading) return;

    const pendingKindFromStorage = getPendingCheckout();
    if (!pendingKindFromStorage) return;

    resumedRef.current = true;
    clearPendingCheckout();

    const product = findProductByKind(pendingKindFromStorage);
    if (!product || product.mode === 'none') return;

    void launchCheckout(product);
    // launchCheckout reads `session`, `hasActiveSub`, etc. from closure;
    // we intentionally exclude it from the dep array — it'd re-create
    // every render and we only want this to fire once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, subLoading]);

  const ctaLabelFor = (product: StripeProduct): string => {
    if (pendingKind === product.kind) return 'Redirecting…';
    if (product.mode === 'none') return product.ctaLabel;
    if (session && subLoading) return 'Loading…';
    if (!session) return product.ctaLabel;
    if (hasActiveSub && (product.kind === 'workspace_monthly' || product.kind === 'workspace_annual')) {
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
  const bg = isLight ? 'bg-[#f5f7fa]' : 'bg-[#0d1118]';
  const border = isLight ? 'border-[#e2e8ee]' : 'border-white/[0.05]';
  const cardBg = isLight
    ? 'bg-white border-[#e2e8ee]'
    : 'bg-[#161d25] border-white/[0.07]';
  const featuredCardBg = isLight
    ? 'bg-[#1a1f28] border-[#1a1f28]'
    : 'bg-[#4a6fa5]/20 border-[#4a6fa5]/40';
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
          <p className="text-xs font-semibold text-[#6e8fb5] uppercase tracking-widest mb-4">
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
                : 'text-[#d2d7e0]/70'
              : mutedColor;
            const priceTone = isFeatured ? 'text-white' : headingColor;
            const descTone = isFeatured
              ? isLight
                ? 'text-white/55'
                : 'text-[#d2d7e0]/50'
              : bodyColor;
            const featTone = isFeatured
              ? isLight
                ? 'text-white/75'
                : 'text-[#d2d7e0]/70'
              : bodyColor;
            const checkTone = isFeatured
              ? isLight
                ? 'text-[#6e8fb5]'
                : 'text-[#7aafd4]'
              : 'text-[#6e8fb5]';
            const buttonClasses = isFeatured
              ? isLight
                ? 'bg-white text-[#1a1f28] hover:bg-[#f0f4f8]'
                : 'bg-white/[0.12] text-white hover:bg-white/[0.18] border border-white/[0.12]'
              : isLight
              ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
              : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';

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
                        ? 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(74,111,165,0.35) 0%, transparent 70%)'
                        : 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(74,111,165,0.25) 0%, transparent 70%)',
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
                              ? 'bg-[#6e8fb5]/30 text-[#d0dff0]'
                              : 'bg-[#6e8fb5]/25 text-[#a8c0d8]'
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
                              : 'text-[#d2d7e0]/45'
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
                    ? 'border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
                    : 'border border-white/[0.1] text-[#d2d7e0] hover:bg-white/[0.04]'
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
                    ? 'border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
                    : 'border border-white/[0.1] text-[#d2d7e0] hover:bg-white/[0.04]'
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
