import { useState, useEffect, useRef } from 'react';
import { Menu, X, Activity, LayoutDashboard, LogOut, ChevronDown, User, Home, Sun, Moon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import type { AppView } from '../App';
import type { SettingsSection } from './dashboard/Dashboard';

interface NavbarProps {
  view: AppView;
  onViewChange: (view: AppView) => void;
  onDashboardHome: () => void;
  onOpenSettingsSection: (section: SettingsSection) => void;
}

export default function Navbar({ view, onViewChange, onDashboardHome, onOpenSettingsSection }: NavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { signOut, user, session } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const isLight = theme === 'light';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navLinks = [
    { label: 'How It Works', href: '#what-it-does' },
    { label: 'Contact', href: '#contact' },
  ];

  const isDashboard = view === 'dashboard';
  const isLoggedIn = !!session;

  const handleSignOut = async () => {
    await signOut();
    onViewChange('landing');
    setMobileOpen(false);
  };

  const handleDashboardHome = () => {
    onDashboardHome();
    setUserMenuOpen(false);
    setMobileOpen(false);
  };

  const handleOpenSettingsSection = (section: SettingsSection) => {
    onOpenSettingsSection(section);
    setUserMenuOpen(false);
    setMobileOpen(false);
  };

  const headerBg = isLight
    ? scrolled || isDashboard
      ? 'bg-white/95 backdrop-blur-md border-b border-[#e2e8e2]'
      : 'bg-transparent'
    : scrolled || isDashboard
      ? 'bg-[#0d110e]/95 backdrop-blur-md border-b border-white/[0.05]'
      : 'bg-transparent';

  const navLinkClass = isLight
    ? 'px-4 py-2 text-sm font-medium text-[#374137]/70 hover:text-[#1a1f1a] rounded-lg hover:bg-[#1a1f1a]/[0.06] transition-all duration-150'
    : 'px-4 py-2 text-sm font-medium text-[#d2d7d2]/70 hover:text-white rounded-lg hover:bg-white/[0.06] transition-all duration-150';

  const mobileBg = isLight
    ? 'border-t border-[#e2e8e2] bg-white px-4 pb-4 pt-2 shadow-lg'
    : 'border-t border-white/[0.06] bg-[#0d110e] px-4 pb-4 pt-2 shadow-lg';

  const logoTextColor = isLight ? 'text-[#1a1f1a]' : 'text-white';

  const themeButtonClass = isLight
    ? 'p-2 rounded-lg text-[#374137]/60 hover:text-[#1a1f1a] hover:bg-[#1a1f1a]/[0.06] transition-colors'
    : 'p-2 rounded-lg text-[#d2d7d2]/50 hover:text-white hover:bg-white/[0.06] transition-colors';

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${headerBg}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <button
            onClick={() => {
              if (isLoggedIn) {
                onDashboardHome();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              } else {
                onViewChange('landing');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            className="flex items-center gap-2.5 group"
          >
            <div className="w-8 h-8 rounded-lg bg-[#487e4a] flex items-center justify-center shadow-btn group-hover:bg-[#5a9a5c] transition-colors">
              <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className={`text-[15px] font-semibold ${logoTextColor} tracking-tight`}>
              PIQ<span className="text-[#6e966f]">Clinical</span>
            </span>
          </button>

          {isDashboard ? (
            <nav className="hidden md:flex items-center gap-2">
              <div className={`flex items-center gap-2 px-3 py-1.5 ${isLight ? 'bg-[#487e4a]/10 border border-[#487e4a]/20' : 'bg-[#487e4a]/10 border border-[#487e4a]/20'} rounded-lg`}>
                <LayoutDashboard size={14} className="text-[#6e966f]" />
                <span className="text-sm font-medium text-[#6e966f]">Dashboard</span>
              </div>

              <button
                onClick={toggleTheme}
                className={themeButtonClass}
                aria-label="Toggle theme"
              >
                {isLight ? <Moon size={16} /> : <Sun size={16} />}
              </button>

              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-150 group ${isLight ? 'hover:bg-[#1a1f1a]/[0.06]' : 'hover:bg-white/[0.06]'}`}
                >
                  <div className="w-7 h-7 rounded-full bg-[#487e4a]/20 border border-[#487e4a]/30 flex items-center justify-center">
                    <User size={13} className="text-[#6e966f]" />
                  </div>
                  <span className={`text-sm ${isLight ? 'text-[#374137]/60 group-hover:text-[#1a1f1a]' : 'text-[#d2d7d2]/60 group-hover:text-white'} transition-colors max-w-[140px] truncate`}>
                    {user?.email ?? 'Account'}
                  </span>
                  <ChevronDown
                    size={13}
                    className={`${isLight ? 'text-[#374137]/40' : 'text-[#d2d7d2]/40'} transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {userMenuOpen && (
                  <div className={`absolute right-0 top-full mt-2 w-56 ${isLight ? 'bg-white border border-[#e2e8e2]' : 'bg-[#131a14] border border-white/10'} rounded-xl shadow-2xl overflow-hidden z-50`}>
                    <div className={`px-4 py-3 border-b ${isLight ? 'border-[#e2e8e2]' : 'border-white/[0.06]'}`}>
                      <p className={`text-xs ${isLight ? 'text-[#374137]/40' : 'text-[#d2d7d2]/40'} mb-0.5`}>Signed in as</p>
                      <p className={`text-sm ${isLight ? 'text-[#1a1f1a]' : 'text-white'} font-medium truncate`}>{user?.email}</p>
                    </div>
                    <div className="p-1.5">
                      <p className={`px-3 py-1.5 text-[11px] uppercase tracking-wider ${isLight ? 'text-[#374137]/35' : 'text-[#d2d7d2]/35'}`}>
                        Settings
                      </p>
                      <button
                        onClick={() => handleOpenSettingsSection('account')}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm ${isLight ? 'text-[#374137]/60 hover:text-[#1a1f1a] hover:bg-[#1a1f1a]/[0.05]' : 'text-[#d2d7d2]/60 hover:text-white hover:bg-white/[0.05]'} rounded-lg transition-all duration-150`}
                      >
                        <Home size={14} />
                        Account
                      </button>
                      <button
                        onClick={() => handleOpenSettingsSection('organization')}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm ${isLight ? 'text-[#374137]/60 hover:text-[#1a1f1a] hover:bg-[#1a1f1a]/[0.05]' : 'text-[#d2d7d2]/60 hover:text-white hover:bg-white/[0.05]'} rounded-lg transition-all duration-150`}
                      >
                        <Home size={14} />
                        Organization
                      </button>
                      <button
                        onClick={() => handleOpenSettingsSection('security')}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm ${isLight ? 'text-[#374137]/60 hover:text-[#1a1f1a] hover:bg-[#1a1f1a]/[0.05]' : 'text-[#d2d7d2]/60 hover:text-white hover:bg-white/[0.05]'} rounded-lg transition-all duration-150`}
                      >
                        <Home size={14} />
                        Security
                      </button>
                      <div className={`my-1 h-px ${isLight ? 'bg-[#e2e8e2]' : 'bg-white/[0.05]'}`} />
                      <button
                        onClick={handleSignOut}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-red-500/80 hover:text-red-500 hover:bg-red-500/[0.06] rounded-lg transition-all duration-150"
                      >
                        <LogOut size={14} />
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </nav>
          ) : (
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <a key={link.label} href={link.href} className={navLinkClass}>
                  {link.label}
                </a>
              ))}

              <button
                onClick={toggleTheme}
                className={`ml-1 ${themeButtonClass}`}
                aria-label="Toggle theme"
              >
                {isLight ? <Moon size={16} /> : <Sun size={16} />}
              </button>

              {isLoggedIn ? (
                <button
                  onClick={() => onViewChange('dashboard')}
                  className="ml-2 px-4 py-2 text-sm font-semibold text-white bg-[#487e4a] rounded-lg hover:bg-[#5a9a5c] transition-all duration-150 shadow-btn hover:shadow-btn-hover"
                >
                  Dashboard
                </button>
              ) : (
                <>
                  <button
                    onClick={() => onViewChange('login')}
                    className={`ml-1 ${navLinkClass}`}
                  >
                    Log In
                  </button>
                  <a
                    href="#contact"
                    className="ml-2 px-4 py-2 text-sm font-semibold text-white bg-[#487e4a] rounded-lg hover:bg-[#5a9a5c] transition-all duration-150 shadow-btn hover:shadow-btn-hover"
                  >
                    Get Started
                  </a>
                </>
              )}
            </nav>
          )}

          <div className="md:hidden flex items-center gap-1">
            <button
              onClick={toggleTheme}
              className={themeButtonClass}
              aria-label="Toggle theme"
            >
              {isLight ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button
              className={`p-2 rounded-lg ${isLight ? 'text-[#374137]/70 hover:text-[#1a1f1a] hover:bg-[#1a1f1a]/[0.06]' : 'text-[#d2d7d2]/70 hover:text-white hover:bg-white/[0.06]'} transition-colors`}
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div className={`md:hidden ${mobileBg}`}>
          {isDashboard ? (
            <>
              <div className={`px-3 py-2.5 border-b ${isLight ? 'border-[#e2e8e2]' : 'border-white/[0.06]'} mb-1`}>
                <p className={`text-xs ${isLight ? 'text-[#374137]/40' : 'text-[#d2d7d2]/40'} mb-0.5`}>Signed in as</p>
                <p className={`text-sm ${isLight ? 'text-[#1a1f1a]' : 'text-white'} font-medium truncate`}>{user?.email}</p>
              </div>
              <button
                onClick={() => handleOpenSettingsSection('account')}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#374137]/70 hover:text-[#1a1f1a] hover:bg-[#1a1f1a]/[0.06]' : 'text-[#d2d7d2]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
              >
                <Home size={14} />
                Account
              </button>
              <button
                onClick={() => handleOpenSettingsSection('organization')}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#374137]/70 hover:text-[#1a1f1a] hover:bg-[#1a1f1a]/[0.06]' : 'text-[#d2d7d2]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
              >
                <Home size={14} />
                Organization
              </button>
              <button
                onClick={() => handleOpenSettingsSection('security')}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#374137]/70 hover:text-[#1a1f1a] hover:bg-[#1a1f1a]/[0.06]' : 'text-[#d2d7d2]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
              >
                <Home size={14} />
                Security
              </button>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium text-red-500/80 hover:text-red-500 rounded-lg hover:bg-red-500/[0.06] transition-colors"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </>
          ) : (
            <>
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`block px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#374137]/70 hover:text-[#1a1f1a] hover:bg-[#1a1f1a]/[0.06]' : 'text-[#d2d7d2]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
                >
                  {link.label}
                </a>
              ))}
              {isLoggedIn ? (
                <button
                  onClick={() => { onViewChange('dashboard'); setMobileOpen(false); }}
                  className="mt-2 w-full text-center px-4 py-2.5 text-sm font-semibold text-white bg-[#487e4a] rounded-lg hover:bg-[#5a9a5c] transition-colors block"
                >
                  Dashboard
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { onViewChange('login'); setMobileOpen(false); }}
                    className={`w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#374137]/70 hover:text-[#1a1f1a] hover:bg-[#1a1f1a]/[0.06]' : 'text-[#d2d7d2]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors text-left`}
                  >
                    Log In
                  </button>
                  <a
                    href="#contact"
                    onClick={() => setMobileOpen(false)}
                    className="mt-2 block text-center px-4 py-2.5 text-sm font-semibold text-white bg-[#487e4a] rounded-lg hover:bg-[#5a9a5c] transition-colors"
                  >
                    Get Started
                  </a>
                </>
              )}
            </>
          )}
        </div>
      )}
    </header>
  );
}
