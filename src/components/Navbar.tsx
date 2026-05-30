import { useState, useEffect, useRef } from 'react';
import { Menu, X, LogOut, ChevronDown, User, Home, Sun, Moon, ClipboardList, Flame, UserCircle2, CreditCard, Beaker, Building2, Plus, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useMode, type DashboardMode } from '../context/ModeContext';
import { useProtocol } from '../context/ProtocolContext';
import { useAudit } from '../context/AuditContext';
import { useHeatmap } from '../context/HeatmapContext';
import { useDemoMode } from '../context/DemoModeContext';
import { getProtocolColors } from '../lib/site/protocolColors';
import OrgSettingsDrawer from './dashboard/orgs/OrgSettingsDrawer';
import MembersDrawer from './dashboard/orgs/MembersDrawer';
import OrgSwitcher from './dashboard/orgs/OrgSwitcher';
import ProtocolUploadModal from './dashboard/site/ProtocolUploadModal';
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
  const [orgDrawerOpen, setOrgDrawerOpen] = useState(false);
  const [membersDrawerOpen, setMembersDrawerOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [protocolMenuOpen, setProtocolMenuOpen] = useState(false);
  const [addProtocolOpen, setAddProtocolOpen] = useState(false);
  const [auditMenuOpen, setAuditMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const protocolMenuRef = useRef<HTMLDivElement>(null);
  const auditMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const { signOut, user, session } = useAuth();
  const { enabled: heatmapEnabled, toggle: toggleHeatmap } = useHeatmap();
  const { theme, toggleTheme } = useTheme();
  const { mode, setMode } = useMode();
  const { protocols, isLoading: protocolsLoading, activeProtocol, setActiveProtocol } = useProtocol();
  const { audits, activeAudit, setActiveAudit } = useAudit();
  const { demoActive, setDemoActive, canUseDemo } = useDemoMode();

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
      className={`inline-flex items-center p-0.5 rounded-lg border ${isLight ? 'border-[#E2E8F0] bg-[#F2F2F2]' : 'border-white/[0.08] bg-white/[0.04]'} ${extraClassName}`}
    >
      {modeOptions.map(({ id, label }) => {
        const active = mode === id;
        const activeClass = isLight
          ? 'bg-brand-600 text-white shadow-sm'
          : 'bg-brand-600 text-white shadow-sm';
        const inactiveClass = isLight
          ? 'text-[#334155]/60 hover:text-[#0F172A]'
          : 'text-[#CBD5E1]/60 hover:text-white';
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
        className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${isLight ? 'border-[#E2E8F0] bg-[#F2F2F2] text-[#334155] hover:bg-[#e4ebf2]' : 'border-white/[0.08] bg-white/[0.04] text-[#CBD5E1] hover:bg-white/[0.08]'}`}
        aria-haspopup="listbox"
        aria-expanded={modeMenuOpen}
      >
        {activeModeLabel}
        <ChevronDown size={12} className={`transition-transform duration-150 ${modeMenuOpen ? 'rotate-180' : ''}`} />
      </button>
      {modeMenuOpen && (
        <div
          className={`absolute left-0 top-full mt-1.5 w-36 rounded-lg shadow-lg border overflow-hidden z-50 ${isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10'}`}
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
                    ? 'bg-brand-600 text-white'
                    : isLight
                    ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]'
                    : 'text-[#CBD5E1]/70 hover:bg-white/[0.05]'
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
        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${isLight ? 'border-[#E2E8F0] bg-white text-[#334155] hover:bg-[#F8FAFC]' : 'border-white/[0.08] bg-[#0F172A] text-[#CBD5E1] hover:bg-white/[0.08]'}`}
        aria-haspopup="listbox"
        aria-expanded={protocolMenuOpen}
        title={isHomeScope ? 'All protocols — combined view' : activeProtocol.name}
      >
        {isHomeScope ? (
          <Home size={12} className={`flex-shrink-0 ${isLight ? 'text-brand-600' : 'text-brand-300'}`} />
        ) : (
          (() => {
            const colors = getProtocolColors(activeProtocol.code);
            return (
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  isLight ? colors.dotLight : colors.dotDark
                }`}
              />
            );
          })()
        )}
        <span className="truncate max-w-[110px]">{isHomeScope ? 'All protocols' : activeProtocol.code}</span>
        <ChevronDown size={12} className={`transition-transform duration-150 flex-shrink-0 ${protocolMenuOpen ? 'rotate-180' : ''}`} />
      </button>
      {protocolMenuOpen && (
        <div
          className={`absolute left-0 top-full mt-1.5 w-72 rounded-lg shadow-lg border overflow-hidden z-50 ${isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10'}`}
          role="listbox"
        >
          <div className={`px-3 py-2 border-b ${isLight ? 'border-[#E2E8F0]' : 'border-white/[0.06]'}`}>
            <p className={`text-[10px] uppercase tracking-wider font-semibold ${isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/35'}`}>
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
                  ? 'bg-brand-600/10'
                  : 'bg-brand-600/15'
                : isLight
                ? 'hover:bg-[#0F172A]/[0.04]'
                : 'hover:bg-white/[0.04]'
            }`}
            role="option"
            aria-selected={isHomeScope}
          >
            <Home size={14} className={`mt-0.5 flex-shrink-0 ${isHomeScope ? (isLight ? 'text-brand-600' : 'text-brand-300') : isLight ? 'text-[#334155]/50' : 'text-[#CBD5E1]/45'}`} />
            <div className="min-w-0">
              <div className={`text-xs font-semibold ${isHomeScope ? (isLight ? 'text-brand-600' : 'text-brand-300') : isLight ? 'text-[#0F172A]' : 'text-white'}`}>
                All protocols
              </div>
              <div className={`text-[11px] mt-0.5 ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'}`}>
                Combined view across every study
              </div>
            </div>
          </button>
          <div className={`px-3 py-2 border-y ${isLight ? 'border-[#E2E8F0] bg-[#F8FAFC]' : 'border-white/[0.06] bg-white/[0.02]'}`}>
            <p className={`text-[10px] uppercase tracking-wider font-semibold ${isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/35'}`}>
              Your protocols
            </p>
          </div>
          {protocolsLoading ? (
            <div className={`px-3 py-3 text-[11px] ${isLight ? 'text-[#334155]/45' : 'text-[#CBD5E1]/40'}`}>
              Loading protocols…
            </div>
          ) : protocols.length === 0 ? (
            <div className={`px-3 py-3 text-[11px] ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/50'}`}>
              No protocols yet. Upload one to get started.
            </div>
          ) : protocols.map((p) => {
            const active = !isHomeScope && p.id === activeProtocol.id;
            const colors = getProtocolColors(p.code);
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
                      ? 'bg-brand-600/10'
                      : 'bg-brand-600/15'
                    : isLight
                    ? 'hover:bg-[#0F172A]/[0.04]'
                    : 'hover:bg-white/[0.04]'
                }`}
                role="option"
                aria-selected={active}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      isLight ? colors.dotLight : colors.dotDark
                    }`}
                  />
                  <div
                    className={`text-xs font-semibold ${
                      active
                        ? isLight
                          ? 'text-brand-600'
                          : 'text-brand-300'
                        : isLight
                        ? 'text-[#0F172A]'
                        : 'text-white'
                    }`}
                  >
                    {p.code}
                  </div>
                </div>
                <div className={`text-[11px] mt-0.5 ml-4 truncate ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'}`}>
                  {p.sponsor} · {p.phase}
                </div>
              </button>
            );
          })}
          <div className={`border-t ${isLight ? 'border-[#E2E8F0]' : 'border-white/[0.06]'}`}>
            {!isHomeScope && (
              <button
                type="button"
                onClick={() => {
                  setProtocolMenuOpen(false);
                  setMembersDrawerOpen(true);
                }}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors ${
                  isLight
                    ? 'text-[#334155] hover:bg-[#0F172A]/[0.04]'
                    : 'text-[#CBD5E1] hover:bg-white/[0.04]'
                }`}
              >
                <Users size={13} />
                <span className="text-xs font-semibold">Manage members</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setProtocolMenuOpen(false);
                setAddProtocolOpen(true);
              }}
              className={`w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors ${
                isLight
                  ? 'text-brand-600 hover:bg-brand-600/[0.06]'
                  : 'text-brand-300 hover:bg-white/[0.04]'
              }`}
            >
              <Plus size={13} />
              <span className="text-xs font-semibold">Upload protocol</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderAuditPicker = () => (
    <div className="relative" ref={auditMenuRef}>
      <button
        type="button"
        onClick={() => setAuditMenuOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${isLight ? 'border-[#E2E8F0] bg-white text-[#334155] hover:bg-[#F8FAFC]' : 'border-white/[0.08] bg-[#0F172A] text-[#CBD5E1] hover:bg-white/[0.08]'}`}
        aria-haspopup="listbox"
        aria-expanded={auditMenuOpen}
        title={activeAudit ? activeAudit.audit_name : 'No audit selected'}
      >
        {activeAudit ? (
          (() => {
            const colors = getProtocolColors(activeAudit.protocol_code);
            return (
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  isLight ? colors.dotLight : colors.dotDark
                }`}
              />
            );
          })()
        ) : (
          <ClipboardList size={12} className={`flex-shrink-0 ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'}`} />
        )}
        <span className="truncate max-w-[160px]">
          {activeAudit ? activeAudit.audit_name : 'Select audit'}
        </span>
        <ChevronDown size={12} className={`transition-transform duration-150 flex-shrink-0 ${auditMenuOpen ? 'rotate-180' : ''}`} />
      </button>
      {auditMenuOpen && (
        <div
          className={`absolute left-0 top-full mt-1.5 w-80 rounded-lg shadow-lg border overflow-hidden z-50 ${isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10'}`}
          role="listbox"
        >
          <div className={`px-3 py-2 border-b ${isLight ? 'border-[#E2E8F0]' : 'border-white/[0.06]'}`}>
            <p className={`text-[10px] uppercase tracking-wider font-semibold ${isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/35'}`}>
              Active audits
            </p>
          </div>
          {audits.length === 0 ? (
            <div className={`px-3 py-4 text-xs ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'}`}>
              No audits yet.
            </div>
          ) : (
            audits.map((a) => {
              const active = activeAudit?.id === a.id;
              const colors = getProtocolColors(a.protocol_code);
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
                        ? 'bg-brand-600/10'
                        : 'bg-brand-600/15'
                      : isLight
                      ? 'hover:bg-[#0F172A]/[0.04]'
                      : 'hover:bg-white/[0.04]'
                  }`}
                  role="option"
                  aria-selected={active}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        isLight ? colors.dotLight : colors.dotDark
                      }`}
                    />
                    <div
                      className={`text-xs font-semibold truncate ${
                        active
                          ? isLight
                            ? 'text-brand-600'
                            : 'text-brand-300'
                          : isLight
                          ? 'text-[#0F172A]'
                          : 'text-white'
                      }`}
                    >
                      {a.audit_name}
                    </div>
                  </div>
                  <div className={`text-[11px] mt-0.5 ml-4 truncate ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'}`}>
                    {a.vendor_name} · {a.protocol_code}
                  </div>
                  <div className={`text-[10px] mt-0.5 ml-4 uppercase tracking-wider font-medium ${isLight ? 'text-[#334155]/45' : 'text-[#CBD5E1]/40'}`}>
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
    { label: 'Pricing', href: '#pricing' },
    { label: 'FAQ', href: '#faq' },
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
      ? 'bg-white/95 backdrop-blur-md border-b border-[#E2E8F0]'
      : 'bg-transparent'
    : scrolled || isDashboard
      ? 'bg-[#020617]/95 backdrop-blur-md border-b border-white/[0.05]'
      : 'bg-transparent';

  const navLinkClass = isLight
    ? 'px-4 py-2 text-sm font-medium text-[#334155]/70 hover:text-[#0F172A] rounded-lg hover:bg-[#0F172A]/[0.06] transition-all duration-150'
    : 'px-4 py-2 text-sm font-medium text-[#CBD5E1]/70 hover:text-white rounded-lg hover:bg-white/[0.06] transition-all duration-150';

  const mobileBg = isLight
    ? 'border-t border-[#E2E8F0] bg-white px-4 pb-4 pt-2 shadow-lg'
    : 'border-t border-white/[0.06] bg-[#020617] px-4 pb-4 pt-2 shadow-lg';

  const logoTextColor = 'text-fg-heading';
  // Mode-aware brand color for the wordmark "PIQC" prefix:
  // - Audit Mode → brand teal (`#02BBB8`), matches audit-mode component recolor.
  // - Site Mode / SOTR / landing / auth → brand blue (`#017BC8`).
  const brandTextColor = isDashboard && mode === 'audit' ? 'text-brand-600' : 'text-brand-600';

  return (
    <>
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
              <img
                src="/PIQC_Logo.png"
                alt=""
                className="w-8 h-8 object-contain group-hover:scale-105 transition-transform"
              />
              <span className={`text-[15px] font-semibold ${logoTextColor} tracking-tight`}>
                <span className={brandTextColor}>PIQC</span>linical
              </span>
            </button>

            {isDashboard && <div className="hidden md:inline-flex">{renderModeSwitcher()}</div>}
            {isDashboard && <div className="md:hidden">{renderModeDropdown()}</div>}
            {isDashboard && mode === 'site' && renderProtocolPicker()}
            {isDashboard && mode === 'audit' && renderAuditPicker()}
            {isDashboard && <OrgSwitcher />}
          </div>

          {isDashboard ? (
            <nav className="hidden md:flex items-center gap-2">
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-150 group ${isLight ? 'hover:bg-[#0F172A]/[0.06]' : 'hover:bg-white/[0.06]'}`}
                >
                  <div className="w-7 h-7 rounded-full bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
                    <User size={13} className="text-brand-300" />
                  </div>
                  <span className={`text-sm ${isLight ? 'text-[#334155]/60 group-hover:text-[#0F172A]' : 'text-[#CBD5E1]/60 group-hover:text-white'} transition-colors max-w-[140px] truncate`}>
                    {user?.email ?? 'Account'}
                  </span>
                  {demoActive && (
                    <span
                      className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${isLight ? 'bg-amber-500/10 border-amber-500/30 text-amber-700' : 'bg-amber-400/15 border-amber-400/30 text-amber-300'}`}
                      title="Demo mode active — showing sample data"
                    >
                      Demo
                    </span>
                  )}
                  <ChevronDown
                    size={13}
                    className={`${isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/40'} transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {userMenuOpen && (
                  <div className={`absolute right-0 top-full mt-2 w-56 ${isLight ? 'bg-white border border-[#E2E8F0]' : 'bg-[#0F172A] border border-white/10'} rounded-xl shadow-2xl overflow-y-auto overflow-x-hidden max-h-[calc(100vh-5rem)] z-50`}>
                    <div className={`px-4 py-3 border-b ${isLight ? 'border-[#E2E8F0]' : 'border-white/[0.06]'}`}>
                      <p className={`text-xs ${isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/40'} mb-0.5`}>Signed in as</p>
                      <p className={`text-sm ${isLight ? 'text-[#0F172A]' : 'text-white'} font-medium truncate`}>{user?.email}</p>
                    </div>
                    <div className="p-1.5">
                      <p className={`px-3 py-1.5 text-[11px] uppercase tracking-wider ${isLight ? 'text-[#334155]/35' : 'text-[#CBD5E1]/35'}`}>
                        Settings
                      </p>
                      <button
                        onClick={() => handleOpenSettingsSection('account')}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm ${isLight ? 'text-[#334155]/60 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/60 hover:text-white hover:bg-white/[0.05]'} rounded-lg transition-all duration-150`}
                      >
                        <UserCircle2 size={14} />
                        Account
                      </button>
                      <button
                        onClick={() => handleOpenSettingsSection('billing')}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm ${isLight ? 'text-[#334155]/60 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/60 hover:text-white hover:bg-white/[0.05]'} rounded-lg transition-all duration-150`}
                      >
                        <CreditCard size={14} />
                        Billing
                      </button>
                      <button
                        onClick={() => {
                          setUserMenuOpen(false);
                          setOrgDrawerOpen(true);
                        }}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm ${isLight ? 'text-[#334155]/60 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/60 hover:text-white hover:bg-white/[0.05]'} rounded-lg transition-all duration-150`}
                      >
                        <Building2 size={14} />
                        Organization
                      </button>
                      <p className={`px-3 pt-3 pb-1.5 text-[11px] uppercase tracking-wider ${isLight ? 'text-[#334155]/35' : 'text-[#CBD5E1]/35'}`}>
                        Appearance
                      </p>
                      <button
                        onClick={toggleTheme}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm ${isLight ? 'text-[#334155]/60 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/60 hover:text-white hover:bg-white/[0.05]'} rounded-lg transition-all duration-150`}
                      >
                        {isLight ? <Moon size={14} /> : <Sun size={14} />}
                        Switch to {isLight ? 'Dark' : 'Light'} Mode
                      </button>
                      <button
                        onClick={toggleHeatmap}
                        className={`flex items-center justify-between gap-2.5 w-full px-3 py-2 text-sm ${isLight ? 'text-[#334155]/60 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/60 hover:text-white hover:bg-white/[0.05]'} rounded-lg transition-all duration-150`}
                        title="Toggle the cross-study friction heatmap layer"
                      >
                        <span className="inline-flex items-center gap-2.5">
                          <Flame size={14} />
                          Heatmap layer
                        </span>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                          heatmapEnabled
                            ? isLight
                              ? 'bg-brand-600/10 border-brand-600/25 text-brand-600'
                              : 'bg-brand-300/15 border-brand-300/30 text-brand-300'
                            : isLight
                            ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/55'
                            : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/45'
                        }`}>
                          {heatmapEnabled ? 'On' : 'Off'}
                        </span>
                      </button>
                      {canUseDemo && (
                        <button
                          onClick={() => setDemoActive(!demoActive)}
                          className={`flex items-center justify-between gap-2.5 w-full px-3 py-2 text-sm ${isLight ? 'text-[#334155]/60 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/60 hover:text-white hover:bg-white/[0.05]'} rounded-lg transition-all duration-150`}
                          title="Show sample data instead of real Supabase rows. For pitches and previews only."
                        >
                          <span className="inline-flex items-center gap-2.5">
                            <Beaker size={14} />
                            Demo mode
                          </span>
                          <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                            demoActive
                              ? isLight
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-700'
                                : 'bg-amber-400/15 border-amber-400/30 text-amber-300'
                              : isLight
                              ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/55'
                              : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/45'
                          }`}>
                            {demoActive ? 'On' : 'Off'}
                          </span>
                        </button>
                      )}
                      <div className={`my-1 h-px ${isLight ? 'bg-[#E2E8F0]' : 'bg-white/[0.05]'}`} />
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
                className={`ml-1 p-2 rounded-lg transition-all duration-150 ${isLight ? 'text-[#334155]/55 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.06]' : 'text-[#CBD5E1]/55 hover:text-white hover:bg-white/[0.06]'}`}
                aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
              >
                {isLight ? <Moon size={16} /> : <Sun size={16} />}
              </button>

              {isLoggedIn ? (
                <button
                  onClick={() => onViewChange('dashboard')}
                  className="ml-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-all duration-150 shadow-btn hover:shadow-btn-hover"
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
                  <button
                    onClick={() => onViewChange('login')}
                    className="ml-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-all duration-150 shadow-btn hover:shadow-btn-hover"
                  >
                    Get Started
                  </button>
                </>
              )}
            </nav>
          )}

          <div className="md:hidden flex items-center gap-1">
            <button
              ref={mobileToggleRef}
              className={`p-2 rounded-lg ${isLight ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.06]' : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.06]'} transition-colors`}
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
              <div className={`px-3 py-2.5 border-b ${isLight ? 'border-[#E2E8F0]' : 'border-white/[0.06]'} mb-1`}>
                <p className={`text-xs ${isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/40'} mb-0.5`}>Signed in as</p>
                <p className={`text-sm ${isLight ? 'text-[#0F172A]' : 'text-white'} font-medium truncate`}>{user?.email}</p>
              </div>
              {/* Settings section — mirrors the desktop user menu so mobile/
                  split-screen users get the same controls as full-screen. */}
              <p className={`px-3 py-1.5 text-[11px] uppercase tracking-wider ${isLight ? 'text-[#334155]/35' : 'text-[#CBD5E1]/35'}`}>
                Settings
              </p>
              <button
                onClick={() => { handleOpenSettingsSection('account'); setMobileOpen(false); }}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.06]' : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
              >
                <UserCircle2 size={14} />
                Account
              </button>
              <button
                onClick={() => { handleOpenSettingsSection('billing'); setMobileOpen(false); }}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.06]' : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
              >
                <CreditCard size={14} />
                Billing
              </button>
              <button
                onClick={() => { setMobileOpen(false); setOrgDrawerOpen(true); }}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.06]' : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
              >
                <Building2 size={14} />
                Organization
              </button>
              <p className={`px-3 pt-3 pb-1.5 text-[11px] uppercase tracking-wider ${isLight ? 'text-[#334155]/35' : 'text-[#CBD5E1]/35'}`}>
                Appearance
              </p>
              <button
                onClick={toggleTheme}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.06]' : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
              >
                {isLight ? <Moon size={14} /> : <Sun size={14} />}
                Switch to {isLight ? 'Dark' : 'Light'} Mode
              </button>
              <button
                onClick={toggleHeatmap}
                className={`flex items-center justify-between gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.06]' : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
                title="Toggle the cross-study friction heatmap layer"
              >
                <span className="inline-flex items-center gap-2.5">
                  <Flame size={14} />
                  Heatmap layer
                </span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                  heatmapEnabled
                    ? isLight
                      ? 'bg-brand-600/10 border-brand-600/25 text-brand-600'
                      : 'bg-brand-300/15 border-brand-300/30 text-brand-300'
                    : isLight
                    ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/55'
                    : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/45'
                }`}>
                  {heatmapEnabled ? 'On' : 'Off'}
                </span>
              </button>
              {canUseDemo && (
                <button
                  onClick={() => setDemoActive(!demoActive)}
                  className={`flex items-center justify-between gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.06]' : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
                  title="Show sample data instead of real Supabase rows. For pitches and previews only."
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Beaker size={14} />
                    Demo mode
                  </span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                    demoActive
                      ? isLight
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-700'
                        : 'bg-amber-400/15 border-amber-400/30 text-amber-300'
                      : isLight
                      ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/55'
                      : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/45'
                  }`}>
                    {demoActive ? 'On' : 'Off'}
                  </span>
                </button>
              )}
              <div className={`my-1 h-px ${isLight ? 'bg-[#E2E8F0]' : 'bg-white/[0.05]'}`} />
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
                  className={`block px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.06]' : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
                >
                  {link.label}
                </a>
              ))}
              <button
                onClick={() => { toggleTheme(); setMobileOpen(false); }}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.06]' : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors`}
              >
                {isLight ? <Moon size={14} /> : <Sun size={14} />}
                Switch to {isLight ? 'Dark' : 'Light'} Mode
              </button>

              {isLoggedIn ? (
                <button
                  onClick={() => { onViewChange('dashboard'); setMobileOpen(false); }}
                  className="mt-2 w-full text-center px-4 py-2.5 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-colors block"
                >
                  Dashboard
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { onViewChange('login'); setMobileOpen(false); }}
                    className={`w-full px-3 py-2.5 text-sm font-medium ${isLight ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.06]' : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.06]'} rounded-lg transition-colors text-left`}
                  >
                    Log In
                  </button>
                  <button
                    onClick={() => { onViewChange('login'); setMobileOpen(false); }}
                    className="mt-2 w-full text-center px-4 py-2.5 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-500 transition-colors"
                  >
                    Get Started
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </header>
    {addProtocolOpen && <ProtocolUploadModal onClose={() => setAddProtocolOpen(false)} />}
    {orgDrawerOpen && <OrgSettingsDrawer onClose={() => setOrgDrawerOpen(false)} />}
    {membersDrawerOpen && <MembersDrawer onClose={() => setMembersDrawerOpen(false)} />}
    </>
  );
}
