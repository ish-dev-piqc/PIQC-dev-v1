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
import Login from './components/auth/Login';
import ForgotPassword from './components/auth/ForgotPassword';
import ProfileCompletion from './components/auth/ProfileCompletion';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { ModeProvider } from './context/ModeContext';
import { DemoModeProvider } from './context/DemoModeContext';
import { ProtocolProvider } from './context/ProtocolContext';
import { SiteDataProvider } from './context/SiteDataContext';
import { AuditProvider } from './context/AuditContext';
import { AuditDataProvider } from './context/AuditDataContext';
import { HeatmapProvider } from './context/HeatmapContext';
import { getPendingCheckout } from './lib/billing/pendingCheckout';

export type AppView = 'landing' | 'dashboard' | 'login' | 'forgot-password';

function AppContent() {
  const [view, setView] = useState<AppView>('landing');
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('overview');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account');
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const { session, loading, profile, profileLoading } = useAuth();
  const { theme } = useTheme();

  const profileComplete = !!profile?.profile_completed_at;
  const needsProfileCompletion = !!session && !profileLoading && !profileComplete;

  useEffect(() => {
    if (!loading && session) {
      // Pending-checkout redirect runs regardless of which view we landed
      // on. There's a race: Login.tsx calls onViewChange('dashboard')
      // synchronously after signInWithPassword resolves, but session may
      // update via onAuthStateChange either before or after that call.
      // Whichever order happens, if a pending intent exists we want the
      // user back on landing so Pricing.tsx's auto-resume effect can fire.
      // The intent itself is cleared by Pricing.tsx once it resumes.
      if (getPendingCheckout() && view !== 'landing') {
        setScrollTarget('pricing');
        setView('landing');
        return;
      }
      if (view === 'login' || view === 'landing') {
        setView('dashboard');
      }
    }
    if (!loading && !session && view === 'dashboard') {
      setView('login');
    }
  }, [session, loading, view]);

  // Accept-invite flow: if the URL has ?invite=<token> and the user is signed
  // in, redeem the invite on dashboard load. Strips the param after either
  // success or failure so a refresh doesn't try again. Errors surface as
  // alerts — non-blocking for the rest of the app load.
  useEffect(() => {
    if (loading || !session || profileLoading) return;
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const token = url.searchParams.get('invite');
    if (!token) return;

    let cancelled = false;
    (async () => {
      const { acceptOrgInvite } = await import('./lib/orgs/orgApi');
      const result = await acceptOrgInvite(token);
      if (cancelled) return;
      if (result.ok) {
        alert(`You're now a ${result.data.role} of ${result.data.org_name}.`);
      } else {
        alert(`Couldn't accept invite: ${result.error}`);
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

  const pageBg = theme === 'light' ? 'bg-[#f5f7fa]' : 'bg-[#070d1a]';
  const textColor = theme === 'light' ? 'text-[#1a1f28]' : 'text-white';

  if (loading || (session && profileLoading && !profile)) {
    return (
      <div className={`min-h-screen ${theme === 'light' ? 'bg-[#f5f7fa]' : 'bg-[#0d1118]'} flex items-center justify-center`}>
        <div className="w-6 h-6 border-2 border-[#4a6fa5] border-t-transparent rounded-full animate-spin" />
      </div>
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
      <div className={`min-h-screen ${pageBg} ${textColor} antialiased`}>
        <Navbar
          view={view}
          onViewChange={handleViewChange}
          onDashboardHome={handleDashboardHome}
          onOpenSettingsSection={handleOpenSettingsSection}
        />
        <Dashboard
          activeTab={dashboardTab}
          onTabChange={setDashboardTab}
          settingsSection={settingsSection}
          onSettingsSectionChange={setSettingsSection}
        />
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${pageBg} ${textColor} antialiased`}>
      <Navbar
        view={view}
        onViewChange={handleViewChange}
        onDashboardHome={handleDashboardHome}
        onOpenSettingsSection={handleOpenSettingsSection}
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
        <DemoModeProvider>
          <ModeProvider>
            <ProtocolProvider>
              <SiteDataProvider>
                <AuditProvider>
                  <AuditDataProvider>
                    <HeatmapProvider>
                      <AppContent />
                    </HeatmapProvider>
                  </AuditDataProvider>
                </AuditProvider>
              </SiteDataProvider>
            </ProtocolProvider>
          </ModeProvider>
        </DemoModeProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
