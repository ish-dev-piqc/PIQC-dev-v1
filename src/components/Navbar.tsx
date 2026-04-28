import { useState, useEffect, useRef } from 'react';
import { Menu, X, Activity, LogOut, ChevronDown, User, Home, Sun, Moon, ClipboardList } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useMode, type DashboardMode } from '../context/ModeContext';
import { useProtocol } from '../context/ProtocolContext';
import { useAudit } from '../context/AuditContext';
import type { AuditStage } from '../types/audit';
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
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [protocolMenuOpen, setProtocolMenuOpen] = useState(false);
  const [auditMenuOpen, setAuditMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const protocolMenuRef = useRef<HTMLDivElement>(null);
  const auditMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const { signOut, user, session } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { mode, setMode } = useMode();
  const { protocols, activeProtocol, setActiveProtocol } = useProtocol();
  const { audits, activeAudit, setActiveAudit } = useAudit();

  const STAGE_LABELS: Record<AuditStage, string> = {
    INTAKE: 'Intake',
    VENDOR_ENRICHMENT: 'Vendor enrichment',
    QUESTIONNAIRE_REVIEW: 'Questionnaire review',
    SCOPE_AND_RISK_REVIEW: 'Scope & risk review',
    PRE_AUDIT_DRAFTING: 'Pre-audit drafting',
    AUDIT_CONDUCT: 'Audit conduct',
    REPORT_DRAFTING: 'Report drafting',
    FINAL_REVIEW_EXPORT: 'Final review & export',
  };

  const isLight = theme === 'light';

  const modeOptions: Array<{ id: DashboardMode; label: string }> = [
    { id: 'site', label: 'Site Mode' },
    { id: 'audit', label: 'Audit Mode' },
  ];

  const renderModeSwitcher = (extraClassName = '') => (
    <div
      className={`inline-flex items-center p-0.5 rounded-lg border ${isLight ? 'border-[#dce4ed] bg-[#eef2f6]' : 'border-white/[0.08] bg-white/[0.04]'} ${extraClassName}`}
    >
      {modeOptions.map(({ id, label }) => {
        const active = mode === id;
        const activeClass = isLight
          ? 'bg-[#4a6fa5] text-white shadow-sm'
          : 'bg-[#4a6fa5] text-white shadow-sm';
        const inactiveClass = isLight
          ? 'text-[#374152]/60 hover:text-[#1a1f28]'
          : 'text-[#d2d7e0]/60 hover:text-white';
        return (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 ${active ? activeClass : inactiveClass}`}
            aria-pressed={active}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  const activeModeLabel = modeOptions.find((m) => m.id === mode)?.label ?? 'Site Mode';

  const renderModeDropdown = () => (
    <div className="relative" ref={modeMenuRef}>
      <button
        type="button"
        onClick={() => setModeMenuOpen((o) => !o)}
        className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${isLight ? 'border-[#dce4ed] bg-[#eef2f6] text-[#374152] hover:bg-[#e4ebf2]' : 'border-white/[0.08] bg-white/[0.04] text-[#d2d7e0] hover:bg-white/[0.08]'}`}
        aria-haspopup="listbox"
        aria-expanded={modeMenuOpen}
      >
        {activeModeLabel}
        <ChevronDown size={12} className={`transition-transform duration-150 ${modeMenuOpen ? 'rotate-180' : ''}`} />
      </button>
      {modeMenuOpen && (
        <div
          className={`absolute left-0 top-full mt-1.5 w-36 rounded-lg shadow-lg border overflow-hidden z-50 ${isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/10'}`}
          role="listbox"
        >
          {modeOptions.map(({ id, label }) => {
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMode(id);
                  setModeMenuOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[#4a6fa5] text-white'
                    : isLight
                    ? 'text-[#374152]/70 hover:bg-[#1a1f28]/[0.05]'
                    : 'text-[#d2d7e0]/70 hover:bg-white/[0.05]'
                }`}
                role="option"
                aria-selected={active}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const isHomeScope = activeProtocol === null;

  const renderProtocolPicker = () => (
    <div className="relative" ref={protocolMenuRef}>
      <button
        type="button"
        onClick={() => setProtocolMenuOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${isLight ? 'border-[#dce4ed] bg-white text-[#374152] hover:bg-[#f5f7fa]' : 'border-white/[0.08] bg-[#131a22] text-[#d2d7e0] hover:bg-white/[0.08]'}`}
        aria-haspopup="listbox"
        aria-expanded={protocolMenuOpen}
        title={isHomeScope ? 'All protocols — combined view' : activeProtocol.name}
      >
        {isHomeScope ? (
          <Home size={12} className={`flex-shrink-0 ${isLight ? 'text-[#4a6fa5]' : 'text-[#6e8fb5]'}`} />
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLight ? 'bg-[#4a6fa5]' : 'bg-[#6e8fb5]'}`} />
        )}
        <span className="truncate max-w-[110px]">{isHomeScope ? 'All protocols' : activeProtocol.code}</span>
        <ChevronDown size={12} className={`transition-transform duration-150 flex-shrink-0 ${protocolMenuOpen ? 'rotate-180' : ''}`} />
      </button>
      {protocolMenuOpen && (
        <div
          className={`absolute left-0 top-full mt-1.5 w-72 rounded-lg shadow-lg border overflow-hidden z-50 ${isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/10'}`}
          role="listbox"
        >
          <div className={`px-3 py-2 border-b ${isLight ? 'border-[#e2e8ee]' : 'border-white/[0.06]'}`}>
            <p className={`text-[10px] uppercase tracking-wider font-semibold ${isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35'}`}>
              Scope
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveProtocol(null);
              setProtocolMenuOpen(false);
            }}
            className={`w-full text-left px-3 py-2.5 transition-colors flex items-start gap-2.5 ${
              isHomeScope
                ? isLight
                  ? 'bg-[#4a6fa5]/10'
                  : 'bg-[#4a6fa5]/15'
                : isLight
                ? 'hover:bg-[#1a1f28]/[0.04]'
                : 'hover:bg-white/[0.04]'
            }`}
            role="option"
            aria-selected={isHomeScope}
          >
            <Home size={14} className={`mt-0.5 flex-shrink-0 ${isHomeScope ? (isLight ? 'text-[#4a6fa5]' : 'text-[#6e8fb5]') : isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/45'}`} />
            <div className="min-w-0">
              <div className={`text-xs font-semibold ${isHomeScope ? (isLight ? 'text-[#4a6fa5]' : 'text-[#6e8fb5]') : isLight ? 'text-[#1a1f28]' : 'text-white'}`}>
                All protocols
              </div>
              <div className={`text-[11px] mt-0.5 ${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'}`}>
                Combined view across every study
              </div>
            </div>
          </button>
          <div className={`px-3 py-2 border-y ${isLight ? 'border-[#e2e8ee] bg-[#f5f7fa]' : 'border-white/[0.06] bg-white/[0.02]'}`}>
            <p className={`text-[10px] uppercase tracking-wider font-semibold ${isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35'}`}>
              Your protocols
            </p>
          </div>
          {protocols.map((p) => {
            const active = !isHomeScope && p.id === activeProtocol.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActiveProtocol(p);
                  setProtocolMenuOpen(false);
                }}
                className={`w-full text-left px-3 py-2.5 transition-colors ${
                  active
                    ? isLight
                      ? 'bg-[#4a6fa5]/10'
                      : 'bg-[#4a6fa5]/15'
                    : isLight
                    ? 'hover:bg-[#1a1f28]/[0.04]'
                    : 'hover:bg-white/[0.04]'
                }`}
                role="option"
                aria-selected={active}
              >
                <div
                  className={`text-xs font-semibold ${
                    active
                      ? isLight
                        ? 'text-[#4a6fa5]'
                        : 'text-[#6e8fb5]'
                      : isLight
                      ? 'text-[#1a1f28]'
                      : 'text-white'
                  }`}
                >
                  {p.code}
                </div>
                <div className={`text-[11px] mt-0.5 truncate ${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'}`}>
                  {p.sponsor} · {p.phase}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderAuditPicker = () => (
    <div className="relative" ref={auditMenuRef}>
      <button
        type="button"
        onClick={() => setAuditMenuOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${isLight ? 'border-[#dce4ed] bg-white text-[#374152] hover:bg-[#f5f7fa]' : 'border-white/[0.08] bg-[#131a22] text-[#d2d7e0] hover:bg-white/[0.08]'}`}
        aria-haspopup="listbox"
        aria-expanded={auditMenuOpen}
        title={activeAudit ? activeAudit.audit_name : 'No audit selected'}
      >
        {activeAudit ? (
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLight ? 'bg-[#4a6fa5]' : 'bg-[#6e8fb5]'}`} />
        ) : (
          <ClipboardList size={12} className={`flex-shrink-0 ${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'}`} />
        )}
        <span className="truncate max-w-[160px]">
          {activeAudit ? activeAudit.audit_name : 'Select audit'}
        </span>
        <ChevronDown size={12} className={`transition-transform duration-150 flex-shrink-0 ${auditMenuOpen ? 'rotate-180' : ''}`} />
      </button>
      {auditMenuOpen && (
        <div
          className={`absolute left-0 top-full mt-1.5 w-80 rounded-lg shadow-lg border overflow-hidden z-50 ${isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/10'}`}
          role="listbox"
        >
          <div className={`px-3 py-2 border-b ${isLight ? 'border-[#e2e8ee]' : 'border-white/[0.06]'}`}>
            <p className={`text-[10px] uppercase tracking-wider font-semibold ${isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35'}`}>
              Active audits
            </p>
          </div>
          {audits.length === 0 ? (
            <div className={`px-3 py-4 text-xs ${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'}`}>
              No audits yet.
            </div>
          ) : (
            audits.map((a) => {
              const active = activeAudit?.id === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setActiveAudit(a);
                    setAuditMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${
                    active
                      ? isLight
                        ? 'bg-[#4a6fa5]/10'
                        : 'bg-[#4a6fa5]/15'
                      : isLight
                      ? 'hover:bg-[#1a1f28]/[0.04]'
                      : 'hover:bg-white/[0.04]'
                  }`}
                  role="option"
                  aria-selected={active}
                >
                  <div
                    className={`text-xs font-semibold truncate ${
                      active
                        ? isLight
                          ? 'text-[#4a6fa5]'
                          : 'text-[#6e8fb5]'
                        : isLight
                        ? 'text-[#1a1f28]'
                        : 'text-white'
                    }`}
                  >
                    {a.audit_name}
                  </div>
                  <div className={`text-[11px] mt-0.5 truncate ${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'}`}>
                    {a.vendor_name} · {a.protocol_code}
                  </div>
                  <div className={`text-[10px] mt-0.5 uppercase tracking-wider font-medium ${isLight ? 'text-[#374152]/45' : 'text-[#d2d7e0]/40'}`}>
                    {STAGE_LABELS[a.current_stage]}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );

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
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
      if (protocolMenuRef.current && !protocolMenuRef.current.contains(e.target as Node)) {
        setProtocolMenuOpen(false);
      }
      if (auditMenuRef.current && !auditMenuRef.current.contains(e.target as Node)) {
        setAuditMenuOpen(false);
      }
      // Mobile menu: close if click is outside both the expanded menu and the toggle button.
      const target = e.target as Node;
      const clickedInsideMenu = mobileMenuRef.current?.contains(target) ?? false;
      const clickedToggle = mobileToggleRef.current?.contains(target) ?? false;
      if (!clickedInsideMenu && !clickedToggle) {
        setMobileOpen(false);
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

  const handleOpenSettingsSection = (section: SettingsSection) => {
    onOpenSettingsSection(section);
    setUserMenuOpen(false);
    setMobileOpen(false);
  };

  const headerBg = isLight
    ? scrolled || isDashboard
      ? 'bg-white/95 backdrop-blur-md border-b border-[#e2e8ee]'
      : 'bg-transparent'
    : scrolled || isDashboard
      ? 'bg-[#0d1118]/95 backdrop-blur-md border-b border-white/[0.05]'
      : 'bg-transparent';

  const navLinkClass = isLight
    ? 'px-4 py-2 text-sm font-medium text-[#374152]/70 hover:text-[#1a1f28] rounded-lg hover:bg-[#1a1f28]/[0.06] transition-all duration-150'
    : 'px-4 py-2 text-sm font-medium text-[#d2d7e0]/70 hover:text-white rounded-lg hover:bg-white/[0.06] transition-all duration-150';

  const mobileBg = isLight
    ? 'border-t border-[#e2e8ee] bg-white px-4 pb-4 pt-2 shadow-lg'
    : 'border-t border-white/[0.06] bg-[#0d1118] px-4 pb-4 pt-2 shadow-lg';

  const logoTextColor = isLight ? 'text-[#1a1f28]' : 'text-white';

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${headerBg}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
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
              <div className="w-8 h-8 rounded-lg bg-[#4a6fa5] flex items-center justify-center shadow-btn group-hover:bg-[#5b82b8] transition-colors">
                <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              <span className={`text-[15px] font-semibold ${logoTextColor} tracking-tight`}>
                PIQ<span className="text-[#6e8fb5]">Clinical</span>
              </span>
            </button>

            {isDashboard && <div className="hidden md:inline-flex">{renderModeSwitcher()}</div>}
            {isDashboard && <div className="md:hidden">{renderModeDropdown()}</div>}
            {isDashboard && mode === 'site' && renderProtocolPicker()}
            {isDashboard && mode === 'audit' && renderAuditPicker()}
          </div>

          {isDashboard ? (
            <nav className="hidden md:flex items-center gap-2">
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-150 group ${isLight ? 'hover:bg-[#1a1f28]/[0.06]' : 'hover:bg-white/[0.06]'}`}
                >
                  <div className="w-7 h-7 rounded-full bg-[#4a6fa5]/20 border border-[#4a6fa5]/30 flex items-center justify-center">
                    <User size={13} className="text-[#6e8fb5]" />
                  </div>
                  <span className={`text-sm ${isLight ? 'text-[#374152]/60 group-hover:text-[#1a1f28]' : 'text-[#d2d7e0]/60 group-hover:text-white'} transition-colors max-w-[140px] truncate`}>
                    {user?.email ?? 'Account'}
                  </span>
                  <ChevronDown
                    size={13}
                    className={`${isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/40'} transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {userMenuOpen && (
                  <div className={`absolute right-0 top-full mt-2 w-56 ${isLight ? 'bg-white border border-[#e2e8ee]' : 'bg-[#131a22] border border-white/10'} rounded-xl shadow-2xl overflow-y-auto overflow-x-hidden max-h-[calc(100vh-5rem)] z-50`}>
                    <div className={`px-4 py-3 border-b ${isLight ? 'border-[#e2e8ee]' : 'border-white/[0.06]'}`}>
                      <p className={`text-xs ${isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/40'} mb-0.5`}>Signed in as</p>
                      <p className={`text-sm ${isLight ? 'text-[#1a1f28]' : 'text-white'} font-medium truncate`}>{user?.email}</p>
                    </div>
                    <div className="p-1.5">
                      <p className={`px-3 py-1.5 text-[11px] uppercase tracking-wider ${isLight ? 'text-[#374152]/35' : 'text-[#d2d7e0]/35'}`}>
                        Settings
                      </p>
                      <button
                        onClick={() => handleOpenSettingsSection('account')}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm ${isLight ? 'text-[#374152]/60 hover:text-[#1a1f28] hover:bg-[#1a1f28]/[0.05]' : 'text-[#d2d7e0]/60 hover:text-white hover:bg-white/[0.05]'} rounded-lg transition-all duration-150`}
                      >
                        <Home size={14} />
                        Account
                      </button>
                      <button
                        onClick={() => handleOpenSettingsSection('security')}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm ${isLight ? 'text-[#374152]/60 hover:text-[#1a1f28] hover:bg-[#1a1f28]/[0.05]' : 'text-[#d2d7e0]/60 hover:text-white hover:bg-white/[0.05]'} rounded-lg transition-all duration-150`}
                      >
                        <Home size={14} />
                        Security
                      </button>
                      <p className={`px-3 pt-3 pb-1.5 text-[11px] uppercase tracking-wider ${isLight ? 'text-[#374152]/35' : 'text-[#d2d7e0]/35'}`}>
                        Appearance
                      </p>
                      <button
                        onClick={toggleTheme}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm ${isLight ? 'text-[#374152]/60 hover:text-[#1a1f28] hover:bg-[#1a1f28]/[0.05]' : 'text-[#d2d7e0]/60 hover:text-white hover:bg-white/[0.05]'} rounded-lg transition-all duration-150`}
                      >
                        {isLight ? <Moon size={14} /> : <Sun size={14} />}
                        Switch to {isLight ? 'Dark' : 'Light'} Mode
                      </button>
                      <div className={`my-1 h-px ${isLight ? 'bg-[#e2e8ee]' : 'bg-white/[0.05]'}`} />
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

              {isLoggedIn ? (
                <button
                  onClick={() => onViewChange('dashboard')}
                  className="ml-2 px-4 py-2 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-all duration-150 shadow-btn hover:shadow-btn-hover"
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
                    className="ml-2 px-4 py-2 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-all duration-150 shadow-btn hover:shadow-btn-hover"
                  >
                    Get Started
                  </a>
                </>
              )}
            </nav>
          )}

          <div className="md:hidden flex items-center gap-1">
            <button
              ref={mobileToggleRef}
              className={`p-2 rounded-lg ${isLight ? 'text-[#374152]/70 hover:text-[#1a1f28] hover:bg-[#1a1f28]/[0.06]' : 'text-[#d2d7e0]/70 hover:text-white hover:bg-white/[0.06]'} transition-colors`}
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div ref={mobileMenuRef} className={`md:hidden ${mobileBg}`}>
          {isDashboard ? (
            <>
              <div className={`px-3 py-2.5 border-b ${isLight ? 'border-[#e2e8ee]' : 'border-white/[0.06]'} mb-1`}>
                <p className={`text-xs ${isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/40'} mb-0.5`}>Signed in as</p>
                <p className={`text-sm ${isLight ? 'text-[#1a1f28]' : 'text-white'} font-medium truncate`}>{user?.email}</p>
              </div>
              <button
                onClick={() => handleOpenSettingsSection('account')}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#374152]/70 hover:text-[#1a1f28] hover:bg-[#1a1f28]/[0.06]' : 'text-[#d2d7e0]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
              >
                <Home size={14} />
                Account
              </button>
              <button
                onClick={() => handleOpenSettingsSection('security')}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#374152]/70 hover:text-[#1a1f28] hover:bg-[#1a1f28]/[0.06]' : 'text-[#d2d7e0]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
              >
                <Home size={14} />
                Security
              </button>
              <button
                onClick={() => { toggleTheme(); setMobileOpen(false); }}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#374152]/70 hover:text-[#1a1f28] hover:bg-[#1a1f28]/[0.06]' : 'text-[#d2d7e0]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
              >
                {isLight ? <Moon size={14} /> : <Sun size={14} />}
                Switch to {isLight ? 'Dark' : 'Light'} Mode
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
                  className={`block px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#374152]/70 hover:text-[#1a1f28] hover:bg-[#1a1f28]/[0.06]' : 'text-[#d2d7e0]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
                >
                  {link.label}
                </a>
              ))}
              {isLoggedIn ? (
                <button
                  onClick={() => { onViewChange('dashboard'); setMobileOpen(false); }}
                  className="mt-2 w-full text-center px-4 py-2.5 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-colors block"
                >
                  Dashboard
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { onViewChange('login'); setMobileOpen(false); }}
                    className={`w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#374152]/70 hover:text-[#1a1f28] hover:bg-[#1a1f28]/[0.06]' : 'text-[#d2d7e0]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors text-left`}
                  >
                    Log In
                  </button>
                  <a
                    href="#contact"
                    onClick={() => setMobileOpen(false)}
                    className="mt-2 block text-center px-4 py-2.5 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-colors"
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
