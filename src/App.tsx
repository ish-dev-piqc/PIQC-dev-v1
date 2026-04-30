import { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import ValueProps from './components/ValueProps';
import Contact from './components/Contact';
import Footer from './components/Footer';
import Chatbot from './components/Chatbot';
import Dashboard, { type DashboardTab, type SettingsSection } from './components/dashboard/Dashboard';
import Login from './components/auth/Login';
import ForgotPassword from './components/auth/ForgotPassword';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { ModeProvider } from './context/ModeContext';
import { ProtocolProvider } from './context/ProtocolContext';
import { AuditProvider } from './context/AuditContext';
import { AuditDataProvider } from './context/AuditDataContext';
import { HeatmapProvider } from './context/HeatmapContext';

export type AppView = 'landing' | 'dashboard' | 'login' | 'forgot-password';

function AppContent() {
  const [view, setView] = useState<AppView>('landing');
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('overview');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account');
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const { session, loading } = useAuth();
  const { theme } = useTheme();

  useEffect(() => {
    if (!loading && session && (view === 'login' || view === 'landing')) {
      setView('dashboard');
    }
    if (!loading && !session && view === 'dashboard') {
      setView('login');
    }
  }, [session, loading, view]);

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

  if (loading) {
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
        <Contact />
      </main>
      <Footer />
      <Chatbot />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ModeProvider>
          <ProtocolProvider>
            <AuditProvider>
              <AuditDataProvider>
                <HeatmapProvider>
                  <AppContent />
                </HeatmapProvider>
              </AuditDataProvider>
            </AuditProvider>
          </ProtocolProvider>
        </ModeProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
