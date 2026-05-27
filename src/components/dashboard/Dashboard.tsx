import { useEffect, useState } from 'react';
import { MessageSquare, LayoutDashboard, Activity, FileText, Database, UserCircle2, Users, CalendarCheck, UserCog, CreditCard, Loader2, CheckCircle2, AlertCircle, ClipboardList, type LucideIcon } from 'lucide-react';
import DashboardChat from './DashboardChat';
import KnowledgeBase from './KnowledgeBase';
import TodayTab from './site/TodayTab';
import AskTab from './site/AskTab';
import ParticipantsTab from './site/ParticipantsTab';
import VisitsTab from './site/VisitsTab';
import TeamTab from './site/TeamTab';
import DemoBanner from './site/DemoBanner';
import ReportsTab from './site/ReportsTab';
import ProtocolTab from './site/ProtocolTab';
import ProtocolRequiredGate from './site/ProtocolRequiredGate';
import ProtocolOnboarding from './site/ProtocolOnboarding';
import VisitExecutionTab from './visit-execution/VisitExecutionTab';
import AuditWorkspaceShell from './audit/AuditWorkspaceShell';
import { useTheme } from '../../context/ThemeContext';
import { useMode } from '../../context/ModeContext';
import { useProtocol } from '../../context/ProtocolContext';
import { countWorksheetItemsForStudy } from '../../lib/sotr/sourceEvidenceApi';
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
  | 'protocol'
  | 'team'
  | 'ask'
  // Shared
  | 'reports'
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
  { id: 'protocol', label: 'Protocol', icon: Database },
  { id: 'team', label: 'Team', icon: UserCog },
  { id: 'ask', label: 'Ask', icon: MessageSquare },
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
      <div className={`w-12 h-12 rounded-2xl ${isLight ? 'bg-[#1a1f28]/[0.03] border border-[#e2e8ee]' : 'bg-white/[0.03] border border-white/5'} flex items-center justify-center mb-4`}>
        <FileText size={20} className={isLight ? 'text-[#374152]/25' : 'text-[#d2d7e0]/25'} />
      </div>
      <h3 className={`${isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/50'} font-medium text-sm mb-1`}>{label}</h3>
      <p className={`${isLight ? 'text-[#374152]/20' : 'text-[#d2d7e0]/20'} text-xs max-w-xs`}>This section is coming soon.</p>
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
  const cardClass = isLight ? 'bg-[#f5f7fa] border-[#e2e8ee]' : 'bg-[#0d1118] border-white/8';
  const inputClass = isLight
    ? 'bg-white border-[#d8dfe8] text-[#1a1f28] placeholder-[#374152]/25 focus:border-[#4a6fa5]/60'
    : 'bg-[#131a22] border-white/[0.08] text-white placeholder-[#d2d7e0]/25 focus:border-[#4a6fa5]/60';

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

  // Used by the pilot status panel below. Same flow as PilotCountdownBanner —
  // launches a Stripe Checkout subscription session for the Workspace
  // monthly plan. window.location.href round trips back to the same page.
  const handleUpgradeFromPilot = async () => {
    const workspace = findProductByKind('workspace_monthly');
    if (!workspace) return;
    setUpgradeError('');
    setUpgradeLoading(true);
    setRedirecting(true, 'Opening checkout…');
    try {
      await createCheckoutSession(
        workspace.priceId,
        window.location.href,
        window.location.href,
        'subscription',
      );
    } catch (err) {
      setUpgradeError(err instanceof Error ? err.message : 'Could not start checkout.');
      setUpgradeLoading(false);
      setRedirecting(false);
    }
  };

  // Direct-launch checkout for a no-plan user. Mirrors handleUpgradeFromPilot
  // but accepts a PlanKind so the three plan buttons (Pilot, Workspace
  // monthly, Workspace annual) can all share one handler. Stripe Checkout
  // mode is read from the catalog ('payment' for pilot, 'subscription' for
  // the workspace plans). The 'none' / 'enterprise' kind is filtered out
  // by the caller — those don't have priceIds.
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
      const isWorkspace =
        subscription?.kind === 'workspace_monthly' ||
        subscription?.kind === 'workspace_annual';
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
            <CreditCard size={16} className="text-[#6e8fb5]" />
            <h3 className={`${isLight ? 'text-[#1a1f28]' : 'text-white'} font-medium text-sm`}>Subscription</h3>
          </div>

          {subLoading ? (
            <p className={`text-sm ${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'}`}>
              Loading subscription info…
            </p>
          ) : isPilot ? (
            // Pilot users: one-time payment, no Stripe Subscription to
            // manage. Show the pilot expiry and a clear path to upgrade to
            // a Workspace. We deliberately do NOT show the "Manage billing"
            // button because the Stripe Customer Portal has nothing useful
            // for one-time Orders.
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className={`text-sm font-medium ${isLight ? 'text-[#1a1f28]' : 'text-white'}`}>
                    {subscription?.planName ?? 'Protocol Clarity Pilot'}
                  </p>
                  {pilotExpiresFmt && (
                    <p className={`text-xs mt-0.5 ${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'}`}>
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

              <p className={`text-xs ${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'} leading-relaxed`}>
                {pilotState === 'expired'
                  ? 'Your Pilot has ended. Upgrade to a Workspace to keep your protocols and worksheets and unlock ongoing access.'
                  : 'Your Pilot includes 30 days of access with one protocol and up to three users. Upgrade to a Workspace any time to keep going beyond your pilot.'}
              </p>

              {upgradeError && <p className="text-sm text-red-500">{upgradeError}</p>}

              <button
                type="button"
                onClick={handleUpgradeFromPilot}
                disabled={upgradeLoading}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-colors disabled:opacity-50"
              >
                {upgradeLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Opening checkout…
                  </>
                ) : (
                  'Upgrade to Workspace — $59 / month'
                )}
              </button>
            </div>
          ) : isWorkspace ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className={`text-sm font-medium ${isLight ? 'text-[#1a1f28]' : 'text-white'}`}>
                    {subscription?.planName}
                  </p>
                  {subscription?.currentPeriodEnd && (
                    <p className={`text-xs mt-0.5 ${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'}`}>
                      Renews {subscription.currentPeriodEnd}
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
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-colors disabled:opacity-50"
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
              <p className={`text-xs ${isLight ? 'text-[#374152]/45' : 'text-[#d2d7e0]/35'}`}>
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
                <p className={`text-sm font-medium ${isLight ? 'text-[#1a1f28]' : 'text-white'}`}>
                  No active plan
                </p>
                <p className={`text-xs mt-1 ${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'} leading-relaxed`}>
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
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-colors disabled:opacity-50"
                >
                  Start Pilot — $25 / 30 days
                </button>
                <button
                  type="button"
                  onClick={handleStartPlan('workspace_monthly')}
                  disabled={upgradeLoading}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-colors disabled:opacity-50"
                >
                  Start Workspace — $59 / month
                </button>
                <button
                  type="button"
                  onClick={handleStartPlan('workspace_annual')}
                  disabled={upgradeLoading}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-colors disabled:opacity-50"
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
              <UserCircle2 size={16} className="text-[#6e8fb5]" />
              <h3 className={`${isLight ? 'text-[#1a1f28]' : 'text-white'} font-medium text-sm`}>Account Profile</h3>
            </div>

            <form className="space-y-4" onSubmit={handleProfileSave}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={`${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'} text-xs block mb-1.5`}>First name</label>
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label className={`${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'} text-xs block mb-1.5`}>Last name</label>
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
                    placeholder="Last name"
                  />
                </div>
                <div>
                  <label className={`${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'} text-xs block mb-1.5`}>Title / Department</label>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
                    placeholder="Clinical lead, operations, etc."
                  />
                </div>
                <div>
                  <label className={`${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'} text-xs block mb-1.5`}>Timezone</label>
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
                  <label className={`${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'} text-xs block mb-1.5`}>Organization</label>
                  <input
                    value={organization || '—'}
                    disabled
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm opacity-70 cursor-not-allowed ${inputClass}`}
                  />
                </div>
                <div>
                  <label className={`${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'} text-xs block mb-1.5`}>Work email</label>
                  <input
                    value={user?.email ?? ''}
                    disabled
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm opacity-70 cursor-not-allowed ${inputClass}`}
                  />
                </div>
              </div>

              {profileError && <p className="text-sm text-red-500">{profileError}</p>}
              {profileMessage && <p className="text-sm text-blue-500">{profileMessage}</p>}

              <button
                type="submit"
                disabled={profileSaving}
                className="px-4 py-2 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-colors disabled:opacity-50"
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
        <h2 className={`${isLight ? 'text-[#1a1f28]' : 'text-white'} font-semibold text-lg mb-1`}>Settings</h2>
        <p className={`${isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/40'} text-sm`}>
          Manage your account and security preferences.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px,1fr] gap-4">
        <aside className={`${cardClass} border rounded-xl p-3 h-fit`}>
          <div className="md:hidden mb-2">
            <label className={`${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'} text-xs block mb-1.5`}>Section</label>
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
                      ? 'bg-[#4a6fa5]/15 text-[#5a7fa5]'
                      : isLight
                        ? 'text-[#374152]/65 hover:bg-[#1a1f28]/[0.05] hover:text-[#1a1f28]'
                        : 'text-[#d2d7e0]/60 hover:bg-white/[0.05] hover:text-white'
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
}

export default function Dashboard({
  activeTab,
  onTabChange,
  settingsSection,
  onSettingsSectionChange,
}: DashboardProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<DashboardTab>('overview');
  const [internalSettingsSection, setInternalSettingsSection] = useState<SettingsSection>('account');
  const [chatMessages, setChatMessages] = useState<ExtendedMessage[]>([]);
  const [chatSelectedDocIds, setChatSelectedDocIds] = useState<string[]>([]);
  const { theme } = useTheme();
  const { mode } = useMode();
  const { protocols, isLoading: protocolsLoading, activeProtocol } = useProtocol();
  const isLight = theme === 'light';

  // Awaiting-review count for the Protocol-tab badge. Refreshes when the
  // active protocol changes or the user navigates away from Protocol tab
  // (after a review session, the count drops and the badge updates).
  const [awaitingReviewCount, setAwaitingReviewCount] = useState(0);
  const resolvedActiveTab = activeTab ?? internalActiveTab;
  const resolvedSettingsSection = settingsSection ?? internalSettingsSection;

  const tabs = mode === 'site' ? SITE_TABS : AUDIT_TABS;

  // If the active tab isn't valid for the current mode (and isn't the shared settings tab),
  // fall back to the mode's default landing tab. Catches both mode switches and external
  // tab-change callers (e.g. App setting 'overview' on logo click while in Site Mode).
  useEffect(() => {
    if (resolvedActiveTab === 'settings') return;
    const inList = tabs.some((t) => t.id === resolvedActiveTab);
    if (!inList) {
      const fallback = tabs[0].id;
      onTabChange?.(fallback);
      if (!onTabChange) setInternalActiveTab(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, resolvedActiveTab]);

  // Fetch the awaiting-review count for the active Site Mode protocol so the
  // Protocol tab in the bar can show a badge. Re-runs on protocol switch and
  // when the user navigates away from the Protocol tab (typical scenario:
  // they reviewed some items, switch to Today, badge updates to the new count).
  //
  // Depending on activeProtocol?.id rather than the object itself: ProtocolContext
  // recomputes the object via protocols.find() each render, so the object identity
  // changes even when the protocol hasn't — the id is the stable signal.
  const activeProtocolId = activeProtocol?.id ?? null;
  useEffect(() => {
    if (mode !== 'site' || !activeProtocolId) {
      setAwaitingReviewCount(0);
      return;
    }
    let cancelled = false;
    countWorksheetItemsForStudy(activeProtocolId)
      .then((c) => {
        if (!cancelled) setAwaitingReviewCount(c.awaitingReview);
      })
      .catch(() => {
        if (!cancelled) setAwaitingReviewCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, activeProtocolId, resolvedActiveTab]);

  const pageBg = isLight ? 'bg-[#f5f7fa]' : 'bg-[#0d1118]';
  const tabBarBg = isLight ? 'border-[#e2e8ee] bg-[#f5f7fa]/80' : 'border-white/5 bg-[#0d1118]/80';
  const activeTabClass = isLight
    ? 'text-[#1a1f28] bg-white border border-[#e2e8ee]'
    : 'text-white bg-white/[0.06] border border-white/10';
  const inactiveTabClass = isLight
    ? 'text-[#374152]/40 hover:text-[#374152]/70 hover:bg-[#1a1f28]/[0.03]'
    : 'text-[#d2d7e0]/40 hover:text-[#d2d7e0]/70 hover:bg-white/[0.03]';
  const panelBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';

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
            onNavigateToTeam={() => {
              onTabChange?.('team');
              if (!onTabChange) setInternalActiveTab('team');
            }}
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
      case 'protocol':
        return (
          <ProtocolRequiredGate label="Protocol">
            <ProtocolTab />
          </ProtocolRequiredGate>
        );
      case 'team':
        return (
          <ProtocolRequiredGate label="Team">
            <TeamTab />
          </ProtocolRequiredGate>
        );
      case 'ask':
        return (
          <ProtocolRequiredGate label="Ask">
            <AskTab
              messages={chatMessages}
              setMessages={setChatMessages}
              selectedDocIds={chatSelectedDocIds}
              setSelectedDocIds={setChatSelectedDocIds}
            />
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
              const showAwaitingBadge =
                mode === 'site' && tab.id === 'protocol' && awaitingReviewCount > 0;
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
                  <Icon size={15} className={isActive ? 'text-[#6e8fb5]' : ''} />
                  {tab.label}
                  {showAwaitingBadge && (
                    <span
                      data-testid="protocol-tab-awaiting-badge"
                      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-semibold rounded-full border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/[0.08] dark:text-amber-300"
                      title={`${awaitingReviewCount} parsed item${awaitingReviewCount === 1 ? '' : 's'} awaiting review`}
                    >
                      {awaitingReviewCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col" style={{ minHeight: 0 }}>
        <div className={`flex-1 ${panelBg} border rounded-2xl overflow-hidden flex flex-col`} style={{ minHeight: 0 }}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
