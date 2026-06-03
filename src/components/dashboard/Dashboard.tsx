import { useEffect, useState } from 'react';
import { MessageSquare, LayoutDashboard, Activity, FileText, Database, UserCircle2, Users, CalendarCheck, CreditCard, Loader2, CheckCircle2, AlertCircle, ClipboardList, type LucideIcon } from 'lucide-react';
import DashboardChat from './DashboardChat';
import KnowledgeBase from './KnowledgeBase';
import TodayTab from './site/TodayTab';
import AskBubble from './site/AskBubble';
import ParticipantsTab from './site/ParticipantsTab';
import VisitsTab from './site/VisitsTab';
import OrganizationPage from './organization/OrganizationPage';
import DemoBanner from './site/DemoBanner';
import ReportsTab from './site/ReportsTab';
import ProtocolRequiredGate from './site/ProtocolRequiredGate';
import ProtocolOnboarding from './site/ProtocolOnboarding';
import VisitExecutionTab from './visit-execution/VisitExecutionTab';
import AuditWorkspaceShell from './audit/AuditWorkspaceShell';
import { useTheme } from '../../context/ThemeContext';
import { useMode } from '../../context/ModeContext';
import { useProtocol } from '../../context/ProtocolContext';
import { supabase, type ChatMessage, type RagStatus } from '../../lib/supabase';
import { TIMEZONE_OPTIONS } from '../../lib/timezones';
import { useAuth } from '../../context/AuthContext';
import { useSubscription } from '../../hooks/useSubscription';
import { usePortal } from '../../hooks/usePortal';
import { useCheckout } from '../../hooks/useCheckout';
import { useCheckoutRedirect } from '../../context/CheckoutRedirectContext';
import { findProductByKind } from '../../stripe-config';
import { pilotStatus, pilotDaysRemaining } from '../../lib/entitlements';
import PilotCountdownBanner from '../billing/PilotCountdownBanner';

type ExtendedMessage = ChatMessage & { streaming?: boolean; ragStatus?: RagStatus; ragError?: string };

export type DashboardTab =
  // Audit Mode tabs (current; will be redesigned later)
  | 'audit-overview'
  | 'chat'
  | 'knowledge'
  | 'workflows'
  // Site Mode tabs
  | 'visit-execution'
  | 'today'
  | 'overview'           // legacy alias; redirects to 'visit-execution' via the fallback effect
  | 'participants'
  | 'visits'
  // Shared
  | 'reports'
  | 'organization'
  | 'settings';
export type SettingsSection = 'account' | 'security' | 'billing';

interface TabConfig {
  id: DashboardTab;
  label: string;
  icon: LucideIcon;
}

const SITE_TABS: TabConfig[] = [
  // Visit Prep is the primary Site Mode landing surface — protocol-level
  // execution workspace, available before any participants are enrolled.
  // Today moves to the second slot for participant-day operations.
  { id: 'visit-execution', label: 'Visit Prep', icon: ClipboardList },
  { id: 'today', label: 'Today', icon: LayoutDashboard },
  { id: 'participants', label: 'Participants', icon: Users },
  { id: 'visits', label: 'Visits', icon: CalendarCheck },
  // Team moved to the Organization page (top-level dashboard tab). See
  // src/components/dashboard/organization/OrganizationPage.tsx.
  { id: 'reports', label: 'Reports', icon: FileText },
];

const AUDIT_TABS: TabConfig[] = [
  { id: 'audit-overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'knowledge', label: 'Knowledge Base', icon: Database },
  { id: 'workflows', label: 'Workflows', icon: Activity },
  { id: 'reports', label: 'Reports', icon: FileText },
];


function PlaceholderTab({ label }: { label: string }) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
      <div className={`w-12 h-12 rounded-2xl ${isLight ? 'bg-[#0F172A]/[0.03] border border-[#E2E8F0]' : 'bg-white/[0.03] border border-white/5'} flex items-center justify-center mb-4`}>
        <FileText size={20} className={isLight ? 'text-[#334155]/25' : 'text-[#CBD5E1]/25'} />
      </div>
      <h3 className={`${isLight ? 'text-[#334155]/50' : 'text-[#CBD5E1]/50'} font-medium text-sm mb-1`}>{label}</h3>
      <p className={`${isLight ? 'text-[#334155]/20' : 'text-[#CBD5E1]/20'} text-xs max-w-xs`}>This section is coming soon.</p>
    </div>
  );
}

interface SettingsTabProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

function SettingsTab({ activeSection, onSectionChange }: SettingsTabProps) {
  const { theme } = useTheme();
  const { user, profile } = useAuth();
  const isLight = theme === 'light';
  const cardClass = isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#020617] border-white/8';
  const inputClass = isLight
    ? 'bg-white border-[#E2E8F0] text-[#0F172A] placeholder-[#334155]/25 focus:border-brand-600/60'
    : 'bg-[#0F172A] border-white/[0.08] text-white placeholder-[#CBD5E1]/25 focus:border-brand-600/60';

  // First/last split so each is its own field. Initial population reads
  // `user_metadata.first_name` / `user_metadata.last_name` when set, then
  // falls back to splitting the legacy `full_name` field on the first
  // whitespace so existing accounts don't appear empty.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [title, setTitle] = useState('');
  const [timezone, setTimezone] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  // organization is read-only; comes from AuthContext.profile (single
  // source of truth for user_profiles state). Empty-string fallback so
  // the disabled input always renders.
  const organization = profile?.organization ?? '';

  useEffect(() => {
    if (!user) return;
    const metadata = user.user_metadata ?? {};
    const explicitFirst = (metadata.first_name as string) ?? '';
    const explicitLast = (metadata.last_name as string) ?? '';
    if (explicitFirst || explicitLast) {
      setFirstName(explicitFirst);
      setLastName(explicitLast);
    } else {
      const legacyFull = ((metadata.full_name as string) ?? '').trim();
      const spaceIdx = legacyFull.indexOf(' ');
      if (spaceIdx === -1) {
        setFirstName(legacyFull);
        setLastName('');
      } else {
        setFirstName(legacyFull.slice(0, spaceIdx));
        setLastName(legacyFull.slice(spaceIdx + 1));
      }
    }
    setTitle((metadata.title as string) ?? '');
    setTimezone((metadata.timezone as string) ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [user]);

  const handleProfileSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileError('');
    setProfileMessage('');
    setProfileSaving(true);

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    // Keep the legacy full_name field populated so anything else in the app
    // that reads user_metadata.full_name (badges, signatures) doesn't go
    // blank after this save.
    const fullName = [trimmedFirst, trimmedLast].filter(Boolean).join(' ');

    const { error } = await supabase.auth.updateUser({
      data: {
        first_name: trimmedFirst,
        last_name: trimmedLast,
        full_name: fullName,
        title: title.trim(),
        timezone: timezone.trim(),
      },
    });

    setProfileSaving(false);
    if (error) {
      setProfileError(error.message);
      return;
    }
    setProfileMessage('Profile updated.');
  };

  const { subscription, loading: subLoading } = useSubscription();
  const { openPortal } = usePortal();
  const { createCheckoutSession } = useCheckout();
  const { setRedirecting } = useCheckoutRedirect();
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState('');
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState('');

  const handleManageBilling = async () => {
    setPortalError('');
    setPortalLoading(true);
    setRedirecting(true, 'Opening billing portal…');
    try {
      await openPortal(window.location.href);
    } catch {
      setPortalError('Could not open billing portal. Please try again.');
      setRedirecting(false);
    } finally {
      setPortalLoading(false);
    }
  };

  // Direct-launch checkout. Accepts a PlanKind so the plan buttons
  // (Pilot, Workspace monthly, Workspace annual) can all share one
  // handler. Stripe Checkout mode is read from the catalog ('payment'
  // for pilot, 'subscription' for the workspace plans). The 'none' /
  // 'enterprise' kind is filtered out by the caller — those don't
  // have priceIds. Used by both the pilot panel (Subscribe Monthly /
  // Annual) and the no-plan state.
  const handleStartPlan = (kind: 'pilot' | 'workspace_monthly' | 'workspace_annual') => async () => {
    const product = findProductByKind(kind);
    if (!product || product.mode === 'none') return;
    setUpgradeError('');
    setUpgradeLoading(true);
    setRedirecting(true, 'Opening checkout…');
    try {
      await createCheckoutSession(
        product.priceId,
        window.location.href,
        window.location.href,
        product.mode,
      );
    } catch (err) {
      setUpgradeError(err instanceof Error ? err.message : 'Could not start checkout.');
      setUpgradeLoading(false);
      setRedirecting(false);
    }
  };

  const navItems: Array<{ id: SettingsSection; label: string; icon: LucideIcon }> = [
    { id: 'account', label: 'Account', icon: UserCircle2 },
    { id: 'billing', label: 'Billing', icon: CreditCard },
  ];

  const renderSectionContent = () => {
    if (activeSection === 'billing') {
      const hasActiveSub = subscription?.status === 'active' || subscription?.status === 'trialing';
      const pilotState = pilotStatus(subscription);
      const isPilot = pilotState !== 'none';
      // A user counts as "on Workspace" for UI purposes only if their
      // subscription is currently usable (status active or trialing). A
      // canceled subscription still has kind='workspace_monthly' resolved
      // from price_id, but the user shouldn't see the Manage Billing UI —
      // they should see the no-plan state so they can start fresh.
      const isWorkspace =
        hasActiveSub &&
        (subscription?.kind === 'workspace_monthly' ||
          subscription?.kind === 'workspace_annual');
      const isNoPlan = !subLoading && !isPilot && !isWorkspace;

      const pilotDaysLeft = pilotDaysRemaining(subscription);
      const pilotExpiresFmt = subscription?.pilotExpiresAt
        ? new Date(subscription.pilotExpiresAt).toLocaleDateString()
        : null;

      // Tone for the pilot status chip — green while active, amber as the
      // countdown approaches, rose once expired. Mirrors the heuristics used
      // by PilotCountdownBanner so the two surfaces don't contradict.
      const pilotChipClasses =
        pilotState === 'expired'
          ? isLight
            ? 'bg-rose-50 border-rose-200 text-rose-700'
            : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
          : pilotState === 'expiring_soon'
          ? isLight
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
          : isLight
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300';

      const pilotChipLabel =
        pilotState === 'expired'
          ? 'expired'
          : pilotDaysLeft === 0
          ? 'expires today'
          : pilotDaysLeft === 1
          ? '1 day left'
          : `${pilotDaysLeft} days left`;

      return (
        <section className={`${cardClass} border rounded-xl p-5`}>
          <div className="flex items-center gap-2 mb-4">
            <CreditCard size={16} className="text-brand-300" />
            <h3 className={`${isLight ? 'text-[#0F172A]' : 'text-white'} font-medium text-sm`}>Subscription</h3>
          </div>

          {subLoading ? (
            <p className={`text-sm ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'}`}>
              Loading subscription info…
            </p>
          ) : isPilot ? (
            // Pilot users: one-time payment, no Stripe Subscription to
            // manage — but they're paying customers and should see the
            // same self-service billing surface as Workspace users.
            // Shows pilot status + expiry, inline subscribe options for
            // Workspace Monthly and Annual (matching the no-plan inline
            // checkout pattern below — required because /#pricing is
            // routed away from for signed-in users), and a Manage
            // Billing button matching the Workspace branch's treatment.
            // The Stripe Customer Portal works for one-time-payment
            // customers — receipt, payment method, and support contact
            // are all available; the subscription section is naturally
            // hidden when there's no subscription.
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className={`text-sm font-medium ${isLight ? 'text-[#0F172A]' : 'text-white'}`}>
                    {subscription?.planName ?? 'Protocol Clarity Pilot'}
                  </p>
                  {pilotExpiresFmt && (
                    <p className={`text-xs mt-0.5 ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'}`}>
                      {pilotState === 'expired' ? 'Expired ' : 'Access through '}
                      {pilotExpiresFmt}
                    </p>
                  )}
                </div>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${pilotChipClasses}`}>
                  {pilotState === 'expired' ? <AlertCircle size={11} /> : <CheckCircle2 size={11} />}
                  {pilotChipLabel}
                </span>
              </div>

              <p className={`text-xs ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'} leading-relaxed`}>
                {pilotState === 'expired'
                  ? 'Your Pilot has ended. To continue using PIQClinical, choose a subscription. You can cancel any time.'
                  : 'Your Pilot includes 30 days of access. To continue using PIQClinical, choose a subscription. You can cancel any time.'}
              </p>

              {upgradeError && <p className="text-sm text-red-500">{upgradeError}</p>}

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={handleStartPlan('workspace_monthly')}
                  disabled={upgradeLoading}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-colors disabled:opacity-50"
                >
                  Subscribe — $59 / month
                </button>
                <button
                  type="button"
                  onClick={handleStartPlan('workspace_annual')}
                  disabled={upgradeLoading}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-colors disabled:opacity-50"
                >
                  Subscribe — $599 / year
                </button>
              </div>

              {portalError && <p className="text-sm text-red-500">{portalError}</p>}

              <button
                type="button"
                onClick={handleManageBilling}
                disabled={portalLoading}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border transition-colors disabled:opacity-50 ${
                  isLight
                    ? 'border-brand-600 text-brand-600 hover:bg-brand-600/10'
                    : 'border-brand-300 text-brand-300 hover:bg-brand-300/10'
                }`}
              >
                {portalLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Opening…
                  </>
                ) : (
                  'Manage billing'
                )}
              </button>
              <p className={`text-xs ${isLight ? 'text-[#334155]/45' : 'text-[#CBD5E1]/35'}`}>
                Manage billing to view your receipt, update payment method, or get help.
              </p>
            </div>
          ) : isWorkspace ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className={`text-sm font-medium ${isLight ? 'text-[#0F172A]' : 'text-white'}`}>
                    {subscription?.planName}
                  </p>
                  {subscription?.currentPeriodEnd && (
                    <p className={`text-xs mt-0.5 ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'}`}>
                      Renews {subscription.currentPeriodEnd}
                    </p>
                  )}
                  {/* Active retention coupon / subscription-level discount.
                      Shown only on Workspace panel because pilots are one-time
                      and can't have a recurring discount. Falls back to "no
                      end date" when the discount has no expiry. */}
                  {subscription?.discountPercentOff && (
                    <p className={`text-xs mt-0.5 font-medium ${isLight ? 'text-emerald-700' : 'text-emerald-300'}`}>
                      {subscription.discountPercentOff}% off
                      {subscription.discountEnd
                        ? ` through ${new Date(subscription.discountEnd).toLocaleDateString()}`
                        : ' (no end date)'}
                    </p>
                  )}
                </div>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                  hasActiveSub
                    ? isLight
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : isLight
                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                      : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                }`}>
                  {hasActiveSub ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                  {subscription?.status}
                </span>
              </div>

              {portalError && <p className="text-sm text-red-500">{portalError}</p>}

              <button
                type="button"
                onClick={handleManageBilling}
                disabled={portalLoading}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border transition-colors disabled:opacity-50 ${
                  isLight
                    ? 'border-brand-600 text-brand-600 hover:bg-brand-600/10'
                    : 'border-brand-300 text-brand-300 hover:bg-brand-300/10'
                }`}
              >
                {portalLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Opening…
                  </>
                ) : (
                  'Manage billing'
                )}
              </button>
              <p className={`text-xs ${isLight ? 'text-[#334155]/45' : 'text-[#CBD5E1]/35'}`}>
                Update payment method, download invoices, or cancel your subscription.
              </p>
            </div>
          ) : isNoPlan ? (
            // True "no plan" — no pilot Order, no Workspace Subscription.
            // Inline three direct-launch checkout buttons so the user can
            // restart a subscription without leaving the dashboard. This
            // avoids the broken "View pricing" → /#pricing flow that App.tsx
            // would auto-route around (signed-in users get bounced from
            // landing). Add-ons aren't shown here because they require an
            // active subscription. Enterprise is omitted because its CTA is
            // a contact-form scroll that also depends on landing being
            // rendered.
            <div className="space-y-4">
              <div>
                <p className={`text-sm font-medium ${isLight ? 'text-[#0F172A]' : 'text-white'}`}>
                  No active plan
                </p>
                <p className={`text-xs mt-1 ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'} leading-relaxed`}>
                  Pick a plan to get started. You can change or cancel from this page any time.
                </p>
              </div>

              {upgradeError && <p className="text-sm text-red-500">{upgradeError}</p>}

              {/* Mobile: vertical stack, each button full-width. sm+: horizontal
                  row with auto-width buttons. Same primary-blue treatment for
                  all three so they read as equally-valid choices; the
                  full-screen "Opening checkout…" loader covers the per-button
                  spinner moment so we don't need to render one inline. */}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={handleStartPlan('pilot')}
                  disabled={upgradeLoading}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-colors disabled:opacity-50"
                >
                  Start Pilot — $25 / 30 days
                </button>
                <button
                  type="button"
                  onClick={handleStartPlan('workspace_monthly')}
                  disabled={upgradeLoading}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-colors disabled:opacity-50"
                >
                  Start Workspace — $59 / month
                </button>
                <button
                  type="button"
                  onClick={handleStartPlan('workspace_annual')}
                  disabled={upgradeLoading}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-colors disabled:opacity-50"
                >
                  Switch to Annual — $599 / year
                </button>
              </div>
            </div>
          ) : null}
        </section>
      );
    }

    if (activeSection === 'account') {
      return (
        <div className="space-y-6">
          <section className={`${cardClass} border rounded-xl p-5`}>
            <div className="flex items-center gap-2 mb-4">
              <UserCircle2 size={16} className="text-brand-300" />
              <h3 className={`${isLight ? 'text-[#0F172A]' : 'text-white'} font-medium text-sm`}>Account Profile</h3>
            </div>

            <form className="space-y-4" onSubmit={handleProfileSave}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={`${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'} text-xs block mb-1.5`}>First name</label>
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label className={`${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'} text-xs block mb-1.5`}>Last name</label>
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
                    placeholder="Last name"
                  />
                </div>
                <div>
                  <label className={`${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'} text-xs block mb-1.5`}>Title / Department</label>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
                    placeholder="Clinical lead, operations, etc."
                  />
                </div>
                <div>
                  <label className={`${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'} text-xs block mb-1.5`}>Timezone</label>
                  <select
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
                  >
                    {/* Preserve whatever the user already had (could be an IANA
                        name we don't list) by injecting it as an extra option
                        when it doesn't match a curated entry. */}
                    {timezone && !TIMEZONE_OPTIONS.some((tz) => tz.value === timezone) && (
                      <option value={timezone}>{timezone} (current)</option>
                    )}
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz.value || 'browser'} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'} text-xs block mb-1.5`}>Organization</label>
                  <input
                    value={organization || '—'}
                    disabled
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm opacity-70 cursor-not-allowed ${inputClass}`}
                  />
                </div>
                <div>
                  <label className={`${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'} text-xs block mb-1.5`}>Work email</label>
                  <input
                    value={user?.email ?? ''}
                    disabled
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm opacity-70 cursor-not-allowed ${inputClass}`}
                  />
                </div>
              </div>

              {profileError && <p className="text-sm text-red-500">{profileError}</p>}
              {profileMessage && <p className="text-sm text-brand-500">{profileMessage}</p>}

              <button
                type="submit"
                disabled={profileSaving}
                className="px-4 py-2 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-colors disabled:opacity-50"
              >
                {profileSaving ? 'Saving...' : 'Save profile'}
              </button>
            </form>
          </section>
        </div>
      );
    }

    // Security section was removed — only 'account' and 'billing' are
    // navigable now. This branch is unreachable from the UI but kept as a
    // graceful fallback if a stale URL fragment lands here.
    return null;
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div>
        <h2 className={`${isLight ? 'text-[#0F172A]' : 'text-white'} font-semibold text-lg mb-1`}>Settings</h2>
        <p className={`${isLight ? 'text-[#334155]/50' : 'text-[#CBD5E1]/40'} text-sm`}>
          Manage your account and security preferences.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px,1fr] gap-4">
        <aside className={`${cardClass} border rounded-xl p-3 h-fit`}>
          <div className="md:hidden mb-2">
            <label className={`${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'} text-xs block mb-1.5`}>Section</label>
            <select
              value={activeSection}
              onChange={(event) => onSectionChange(event.target.value as SettingsSection)}
              className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
            >
              {navItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <nav className="hidden md:flex flex-col gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const selected = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSectionChange(item.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    selected
                      ? 'bg-brand-600/15 text-brand-600'
                      : isLight
                        ? 'text-[#334155]/65 hover:bg-[#0F172A]/[0.05] hover:text-[#0F172A]'
                        : 'text-[#CBD5E1]/60 hover:bg-white/[0.05] hover:text-white'
                  }`}
                >
                  <Icon size={14} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <div>{renderSectionContent()}</div>
      </div>
    </div>
  );
}

interface DashboardProps {
  activeTab?: DashboardTab;
  onTabChange?: (tab: DashboardTab) => void;
  settingsSection?: SettingsSection;
  onSettingsSectionChange?: (section: SettingsSection) => void;
  onExitOrganization?: () => void;
  // Lands the Organization page on its Team tab — used by Today's
  // cert-warning band so admins jump straight to fixing the cert. App.tsx
  // writes 'team' to localStorage before calling this; OrganizationPage's
  // mount-time read picks it up.
  onNavigateToOrgTeam?: () => void;
}

export default function Dashboard({
  activeTab,
  onTabChange,
  settingsSection,
  onSettingsSectionChange,
  onExitOrganization,
  onNavigateToOrgTeam,
}: DashboardProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<DashboardTab>('overview');
  const [internalSettingsSection, setInternalSettingsSection] = useState<SettingsSection>('account');
  const [chatMessages, setChatMessages] = useState<ExtendedMessage[]>([]);
  const [chatSelectedDocIds, setChatSelectedDocIds] = useState<string[]>([]);
  const { theme } = useTheme();
  const { mode } = useMode();
  const { protocols, isLoading: protocolsLoading } = useProtocol();
  const isLight = theme === 'light';

  const resolvedActiveTab = activeTab ?? internalActiveTab;
  const resolvedSettingsSection = settingsSection ?? internalSettingsSection;

  const tabs = mode === 'site' ? SITE_TABS : AUDIT_TABS;

  // If the active tab isn't valid for the current mode (and isn't the shared settings tab),
  // fall back to the mode's default landing tab. Catches both mode switches and external
  // tab-change callers (e.g. App setting 'overview' on logo click while in Site Mode).
  useEffect(() => {
    if (resolvedActiveTab === 'settings') return;
    if (resolvedActiveTab === 'organization') return;
    const inList = tabs.some((t) => t.id === resolvedActiveTab);
    if (!inList) {
      const fallback = tabs[0].id;
      onTabChange?.(fallback);
      if (!onTabChange) setInternalActiveTab(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, resolvedActiveTab]);

  const pageBg = isLight ? 'bg-[#F8FAFC]' : 'bg-[#020617]';
  const tabBarBg = isLight ? 'border-[#E2E8F0] bg-[#F8FAFC]/80' : 'border-white/5 bg-[#020617]/80';
  const activeTabClass = isLight
    ? 'text-[#0F172A] bg-white border border-[#E2E8F0]'
    : 'text-white bg-white/[0.06] border border-white/10';
  const inactiveTabClass = isLight
    ? 'text-[#334155]/40 hover:text-[#334155]/70 hover:bg-[#0F172A]/[0.03]'
    : 'text-[#CBD5E1]/40 hover:text-[#CBD5E1]/70 hover:bg-white/[0.03]';
  const panelBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';

  const renderContent = () => {
    switch (resolvedActiveTab) {
      case 'chat':
        return (
          <DashboardChat
            messages={chatMessages}
            setMessages={setChatMessages}
            selectedDocIds={chatSelectedDocIds}
            setSelectedDocIds={setChatSelectedDocIds}
          />
        );
      case 'knowledge':
        return <KnowledgeBase />;
      case 'workflows':
        return <PlaceholderTab label="Workflows" />;
      // Site Mode tabs
      case 'visit-execution':
      case 'overview': // legacy alias — fallback effect redirects; render defensively in the meantime
        return (
          <ProtocolRequiredGate label="Visit Prep">
            <VisitExecutionTab />
          </ProtocolRequiredGate>
        );
      case 'today':
        return (
          <TodayTab
            onNavigateToVisits={() => {
              onTabChange?.('visits');
              if (!onTabChange) setInternalActiveTab('visits');
            }}
            onNavigateToTeam={() => onNavigateToOrgTeam?.()}
          />
        );
      case 'participants':
        return (
          <ProtocolRequiredGate label="Participants">
            <ParticipantsTab />
          </ProtocolRequiredGate>
        );
      case 'visits':
        return (
          <ProtocolRequiredGate label="Visits">
            <VisitsTab />
          </ProtocolRequiredGate>
        );
      // Shared
      case 'reports':
        return (
          <ReportsTab
            onNavigateToVisits={() => {
              onTabChange?.('visits');
              if (!onTabChange) setInternalActiveTab('visits');
            }}
          />
        );
      case 'organization':
        // Org page is rendered via the early-return branch below; this case
        // remains as a defensive fallback if the branch is ever bypassed.
        return <OrganizationPage onExit={onExitOrganization} />;
      case 'settings':
        return (
          <SettingsTab
            activeSection={resolvedSettingsSection}
            onSectionChange={(section) => {
              onSettingsSectionChange?.(section);
              if (!onSettingsSectionChange) setInternalSettingsSection(section);
            }}
          />
        );
    }
  };

  // Organization is its own full-screen destination — no Site/Audit tab strip,
  // no constrained panel. The page owns its own header, sub-tab strip (with a
  // back arrow that calls onExitOrganization), and scroll. Takes priority over
  // both the audit-mode branch and the protocol-onboarding wall: org chrome
  // should always be reachable via the user menu, regardless of mode or
  // whether the user has any protocols yet.
  if (resolvedActiveTab === 'organization') {
    return (
      <div className={`h-screen ${pageBg} pt-16 flex flex-col overflow-hidden`}>
        <OrganizationPage onExit={onExitOrganization} />
      </div>
    );
  }

  // Audit Mode skips the legacy tab rail entirely. The 3-pane workspace shell
  // owns its own navigation (StageNav). Settings is still reachable via the
  // Navbar user dropdown — when activeTab flips to 'settings' we render the
  // Settings tab inside the constrained panel instead of the shell.
  if (mode === 'audit') {
    return (
      <div className={`h-screen ${pageBg} pt-16 flex flex-col overflow-hidden`}>
        {resolvedActiveTab === 'settings' ? (
          <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col" style={{ minHeight: 0 }}>
            <div className={`flex-1 ${panelBg} border rounded-2xl overflow-hidden flex flex-col`} style={{ minHeight: 0 }}>
              {renderContent()}
            </div>
          </div>
        ) : (
          <AuditWorkspaceShell />
        )}
      </div>
    );
  }

  // Site Mode onboarding gate: if the user has zero protocols, replace the
  // entire tab UI with the full-screen upload wall. Settings stays reachable
  // via the Navbar dropdown (which renders above this).
  if (mode === 'site' && !protocolsLoading && protocols.length === 0 && resolvedActiveTab !== 'settings') {
    return (
      <div className={`min-h-screen ${pageBg} pt-16 overflow-y-auto`}>
        <ProtocolOnboarding
          onTabChange={(tab) => {
            onTabChange?.(tab);
            if (!onTabChange) setInternalActiveTab(tab);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`h-screen ${pageBg} pt-16 flex flex-col overflow-hidden`}>
      <DemoBanner />
      {/* Self-hides when pilotStatus === 'none'. Surfaces "N days left" and an
          upgrade-to-Workspace CTA for pilot users; renders nothing otherwise. */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-3">
        <PilotCountdownBanner />
      </div>
      <div className={`flex-shrink-0 border-b ${tabBarBg} backdrop-blur-sm`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = resolvedActiveTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    onTabChange?.(tab.id);
                    if (!onTabChange) setInternalActiveTab(tab.id);
                  }}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-150 whitespace-nowrap ${
                    isActive ? activeTabClass : inactiveTabClass
                  }`}
                >
                  <Icon size={15} className={isActive ? 'text-brand-300' : ''} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content row: main pane (centered). The Ask assistant is mounted as a
          floating bubble (AskBubble) anchored bottom-right via fixed
          positioning, so it sits outside the flex layout and overlays content.
          It's mounted once here so the conversation survives tab switches and
          manages its own collapsed/expanded + per-protocol thread. */}
      <div className="flex-1 flex flex-row min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col" style={{ minHeight: 0 }}>
          <div className={`flex-1 ${panelBg} border rounded-2xl overflow-hidden flex flex-col`} style={{ minHeight: 0 }}>
            {renderContent()}
          </div>
        </div>
      </div>
      <AskBubble />
    </div>
  );
}
