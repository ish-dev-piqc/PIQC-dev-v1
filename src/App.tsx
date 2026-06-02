import { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import ValueProps from './components/ValueProps';
import FAQ from './components/FAQ';
import Pricing from './components/Pricing';
import Contact from './components/Contact';
import Footer from './components/Footer';
import Chatbot from './components/Chatbot';
import Dashboard, { type DashboardTab, type SettingsSection } from './components/dashboard/Dashboard';
import type { OrgTab } from './components/dashboard/organization/OrganizationPage';
import Login from './components/auth/Login';
import ForgotPassword from './components/auth/ForgotPassword';
import ProfileCompletion from './components/auth/ProfileCompletion';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { ModeProvider, useMode } from './context/ModeContext';
import { DemoModeProvider } from './context/DemoModeContext';
import { ProtocolProvider } from './context/ProtocolContext';
import { OrgProvider } from './context/OrgContext';
import { OrgChatProvider } from './context/OrgChatContext';
import { SiteDataProvider } from './context/SiteDataContext';
import { AuditProvider } from './context/AuditContext';
import { AuditDataProvider } from './context/AuditDataContext';
import { HeatmapProvider } from './context/HeatmapContext';
import { CheckoutRedirectProvider, useCheckoutRedirect } from './context/CheckoutRedirectContext';
import { getPendingCheckout } from './lib/billing/pendingCheckout';
import RedirectingToCheckout from './components/billing/RedirectingToCheckout';
import CheckoutResumer from './components/billing/CheckoutResumer';
import InviteWelcomeBanner, {
  type InviteAcceptResult,
} from './components/dashboard/orgs/InviteWelcomeBanner';

export type AppView = 'landing' | 'dashboard' | 'login' | 'forgot-password';

// localStorage key for the active dashboard tab. Survives refreshes so the
// user lands back where they were instead of getting bounced to the mode's
// default tab on reload.
const DASHBOARD_TAB_STORAGE_KEY = 'piq-dashboard-tab-v1';

// Allow-list of DashboardTab string values used to validate localStorage
// reads. Reading raw localStorage and casting to DashboardTab would let a
// stale or corrupted value short-circuit the fallback effect inside
// Dashboard.tsx; this guard returns null on anything unrecognised.
const VALID_DASHBOARD_TABS: ReadonlySet<DashboardTab> = new Set<DashboardTab>([
  'audit-overview',
  'chat',
  'knowledge',
  'workflows',
  'visit-execution',
  'today',
  'overview',
  'participants',
  'visits',
  'reports',
  'organization',
  'settings',
]);

function readStoredDashboardTab(): DashboardTab | null {
  try {
    const v = localStorage.getItem(DASHBOARD_TAB_STORAGE_KEY);
    if (v && VALID_DASHBOARD_TABS.has(v as DashboardTab)) return v as DashboardTab;
  } catch {
    /* ignore — localStorage can throw in privacy/quota edge cases */
  }
  return null;
}

function AppContent() {
  const [view, setView] = useState<AppView>('landing');
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>(
    () => readStoredDashboardTab() ?? 'overview',
  );
  // Tab the user was on before opening Organization — restored on back-arrow exit.
  // Defaults to 'today' so first-time exits land somewhere sensible.
  const [previousDashboardTab, setPreviousDashboardTab] = useState<DashboardTab>('today');
  // Initial Organization-page sub-tab. User-menu navigation lands on 'members';
  // deep-link entry points (e.g. cert-warning band on TodayTab) override to 'team'.
  const [organizationInitialTab, setOrganizationInitialTab] = useState<OrgTab>('members');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account');
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  // Result of the accept-invite handler — surfaced as a banner on the
  // dashboard. null when no recent invite was accepted (or after dismiss).
  const [inviteResult, setInviteResult] = useState<InviteAcceptResult | null>(null);
  const { session, loading, profile, profileLoading } = useAuth();
  const { theme } = useTheme();
  const { isRedirecting } = useCheckoutRedirect();
  const { mode } = useMode();
  // Mode-aware class consumed by CSS variables in src/index.css. Applied
  // unconditionally so the brand-color variables resolve correctly even
  // outside the dashboard view (landing / auth default to mode-site →
  // blue brand). Audit Mode users see teal brand colors everywhere
  // inside the .mode-audit subtree.
  const modeClass = `mode-${mode}`;

  const profileComplete = !!profile?.profile_completed_at;
  const needsProfileCompletion = !!session && !profileLoading && !profileComplete;

  // Persist dashboardTab so a refresh keeps the user on the same area.
  // Skip writing 'overview' — that's our legacy alias that the Dashboard
  // fallback effect immediately rewrites, and persisting it would churn.
  useEffect(() => {
    try {
      if (dashboardTab !== 'overview') {
        localStorage.setItem(DASHBOARD_TAB_STORAGE_KEY, dashboardTab);
      }
    } catch {
      /* ignore localStorage errors */
    }
  }, [dashboardTab]);

  useEffect(() => {
    if (!loading && session && (view === 'login' || view === 'landing')) {
      setView('dashboard');
    }
    if (!loading && !session && view === 'dashboard') {
      setView('login');
    }
  }, [session, loading, view]);

  // Accept-invite flow: if the URL has ?invite=<token> and the user is signed
  // in, redeem the invite on dashboard load. Strips the param after either
  // success or failure so a refresh doesn't try again. Outcome surfaces as
  // an <InviteWelcomeBanner /> at the top of the dashboard, not a native
  // alert popup.
  useEffect(() => {
    if (loading || !session || profileLoading) return;
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const token = url.searchParams.get('invite');
    if (!token) return;

    let cancelled = false;
    (async () => {
      const { acceptOrgInvite } = await import('./lib/orgs/orgsApi');
      const result = await acceptOrgInvite(token);
      if (cancelled) return;
      if (result.ok) {
        setInviteResult({
          ok: true,
          org_name: result.data.org_name,
          role: result.data.role,
          protocol_count: result.data.protocol_count,
        });
      } else {
        setInviteResult({ ok: false, error: result.error });
      }
      url.searchParams.delete('invite');
      window.history.replaceState({}, '', url.toString());
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, session, profileLoading]);

  useEffect(() => {
    if (view === 'landing' && scrollTarget) {
      const el = document.getElementById(scrollTarget);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 50);
      }
      setScrollTarget(null);
    }
  }, [view, scrollTarget]);

  const handleViewChange = (nextView: AppView, anchor?: string) => {
    if (nextView === 'dashboard' && !session) {
      setView('login');
      return;
    }
    if (session && (nextView === 'landing' || nextView === 'login')) {
      setView('dashboard');
      return;
    }
    if (anchor) setScrollTarget(anchor);
    setView(nextView);
    if (nextView === 'landing' && !anchor) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleDashboardHome = () => {
    setDashboardTab('overview');
    setView('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenSettingsSection = (section: SettingsSection) => {
    setSettingsSection(section);
    setDashboardTab('settings');
    setView('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenOrganization = () => {
    // Remember where we were so the back arrow restores it. Avoid saving
    // 'organization' itself (would create a self-loop) or 'settings' (a
    // different cross-mode surface that should exit to its own previous tab).
    if (dashboardTab !== 'organization' && dashboardTab !== 'settings') {
      setPreviousDashboardTab(dashboardTab);
    }
    setOrganizationInitialTab('members');
    setDashboardTab('organization');
    setView('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNavigateToOrgTeam = () => {
    if (dashboardTab !== 'organization' && dashboardTab !== 'settings') {
      setPreviousDashboardTab(dashboardTab);
    }
    setOrganizationInitialTab('team');
    setDashboardTab('organization');
    setView('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleExitOrganization = () => {
    setDashboardTab(previousDashboardTab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pageBg = theme === 'light' ? 'bg-[#F8FAFC]' : 'bg-[#070d1a]';
  const textColor = theme === 'light' ? 'text-[#0F172A]' : 'text-white';

  if (loading || (session && profileLoading && !profile)) {
    return (
      <div className={`min-h-screen ${theme === 'light' ? 'bg-[#F8FAFC]' : 'bg-[#020617]'} flex items-center justify-center`}>
        <div className="w-6 h-6 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Short-circuit to the full-screen Stripe-redirect view whenever we're in
  // the middle of bouncing the user to Stripe — either via auto-resume on
  // the way back from login (session + pendingCheckout still in storage)
  // or because a button somewhere set isRedirecting via context.
  // Renders <CheckoutResumer /> alongside the loader only in the auto-resume
  // case; it fires the checkout call and unmounts on success (navigation).
  const hasPendingCheckoutIntent = !!session && !!getPendingCheckout();
  if (isRedirecting || hasPendingCheckoutIntent) {
    return (
      <>
        <RedirectingToCheckout />
        {hasPendingCheckoutIntent && <CheckoutResumer />}
      </>
    );
  }

  if (view === 'login') {
    return <Login onViewChange={handleViewChange} />;
  }

  if (view === 'forgot-password') {
    return <ForgotPassword onViewChange={handleViewChange} />;
  }

  if (needsProfileCompletion) {
    return <ProfileCompletion />;
  }

  if (view === 'dashboard') {
    return (
      <div className={`${modeClass} min-h-screen ${pageBg} ${textColor} antialiased`}>
        <Navbar
          view={view}
          onViewChange={handleViewChange}
          onDashboardHome={handleDashboardHome}
          onOpenSettingsSection={handleOpenSettingsSection}
          onOpenOrganization={handleOpenOrganization}
        />
        {inviteResult && (
          <InviteWelcomeBanner
            result={inviteResult}
            onDismiss={() => setInviteResult(null)}
          />
        )}
        <Dashboard
          activeTab={dashboardTab}
          onTabChange={setDashboardTab}
          settingsSection={settingsSection}
          onSettingsSectionChange={setSettingsSection}
          onExitOrganization={handleExitOrganization}
          onNavigateToOrgTeam={handleNavigateToOrgTeam}
          organizationInitialTab={organizationInitialTab}
        />
      </div>
    );
  }

  return (
    <div className={`${modeClass} min-h-screen ${pageBg} ${textColor} antialiased`}>
      <Navbar
        view={view}
        onViewChange={handleViewChange}
        onDashboardHome={handleDashboardHome}
        onOpenSettingsSection={handleOpenSettingsSection}
        onOpenOrganization={handleOpenOrganization}
      />
      <main>
        <Hero onViewChange={handleViewChange} />
        <ValueProps />
        <Pricing onViewChange={handleViewChange} />
        <FAQ />
        <Contact />
      </main>
      <Footer onViewChange={handleViewChange} />
      <Chatbot />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <CheckoutRedirectProvider>
        <DemoModeProvider>
          <ModeProvider>
            <ProtocolProvider>
              <OrgProvider>
                <OrgChatProvider>
                  <SiteDataProvider>
                    <AuditProvider>
                      <AuditDataProvider>
                        <HeatmapProvider>
                          <AppContent />
                        </HeatmapProvider>
                      </AuditDataProvider>
                    </AuditProvider>
                  </SiteDataProvider>
                </OrgChatProvider>
              </OrgProvider>
            </ProtocolProvider>
          </ModeProvider>
        </DemoModeProvider>
        </CheckoutRedirectProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
