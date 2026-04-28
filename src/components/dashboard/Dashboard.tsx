import { useEffect, useState } from 'react';
import { MessageSquare, LayoutDashboard, Activity, FileText, Database, UserCircle2, KeyRound, Shield, Users, CalendarCheck, UserCog } from 'lucide-react';
import DashboardChat from './DashboardChat';
import KnowledgeBase from './KnowledgeBase';
import TodayTab from './site/TodayTab';
import ParticipantsTab from './site/ParticipantsTab';
import VisitsTab from './site/VisitsTab';
import TeamTab from './site/TeamTab';
import ProtocolRequiredGate from './site/ProtocolRequiredGate';
import AuditWorkspaceShell from './audit/AuditWorkspaceShell';
import { useTheme } from '../../context/ThemeContext';
import { useMode } from '../../context/ModeContext';
import { supabase, type ChatMessage, type RagStatus } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

type ExtendedMessage = ChatMessage & { streaming?: boolean; ragStatus?: RagStatus; ragError?: string };

export type DashboardTab =
  // Audit Mode tabs (current; will be redesigned later)
  | 'audit-overview'
  | 'chat'
  | 'knowledge'
  | 'workflows'
  // Site Mode tabs
  | 'overview'
  | 'participants'
  | 'visits'
  | 'protocol'
  | 'team'
  | 'ask'
  // Shared
  | 'reports'
  | 'settings';
export type SettingsSection = 'account' | 'security';

interface TabConfig {
  id: DashboardTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const SITE_TABS: TabConfig[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
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

const STAT_CARDS = [
  { label: 'Active Protocols', value: '24', change: '+3 this week', positive: true },
  { label: 'Avg. Resolution Time', value: '4.2h', change: '-12% vs last month', positive: true },
  { label: 'Compliance Score', value: '98.4%', change: '+0.6% this month', positive: true },
  { label: 'Staff Trained', value: '187', change: '12 pending', positive: false },
];

const RECENT_PROTOCOLS = [
  { name: 'Sepsis Early Detection', status: 'Active', updated: '2h ago', category: 'Critical Care' },
  { name: 'Fall Prevention Bundle', status: 'Active', updated: '1d ago', category: 'Patient Safety' },
  { name: 'Medication Reconciliation', status: 'Review', updated: '3d ago', category: 'Pharmacy' },
  { name: 'Hand Hygiene Compliance', status: 'Active', updated: '4d ago', category: 'Infection Control' },
  { name: 'Chest Pain Triage', status: 'Active', updated: '1w ago', category: 'Emergency' },
];

function OverviewTab() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/40';
  const statVal = isLight ? 'text-[#1a1f28]' : 'text-white';
  const rowHover = isLight ? 'hover:bg-[#f5f7fa]' : 'hover:bg-white/[0.02]';
  const rowDivide = isLight ? 'divide-[#f0f4f8]' : 'divide-white/[0.03]';
  const protocolName = isLight ? 'text-[#1a1f28]/90' : 'text-[#d2d7e0]/90';
  const protocolCat = isLight ? 'text-[#374152]/30' : 'text-[#d2d7e0]/30';
  const lastUpdated = isLight ? 'text-[#374152]/25' : 'text-[#d2d7e0]/25';
  const tableHeader = isLight ? 'text-[#374152]/25' : 'text-[#d2d7e0]/25';
  const tableBorder = isLight ? 'border-[#f0f4f8]' : 'border-white/5';

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div>
        <h2 className={`${headingColor} font-semibold text-lg mb-1`}>Dashboard Overview</h2>
        <p className={`${subColor} text-sm`}>Clinical workflow performance at a glance</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map((card, i) => (
          <div key={i} className={`${cardBg} border rounded-xl p-4`}>
            <p className={`${subColor} text-xs mb-2`}>{card.label}</p>
            <p className={`${statVal} font-bold text-2xl mb-1`}>{card.value}</p>
            <p className={`text-xs ${card.positive ? 'text-blue-500' : 'text-amber-500'}`}>
              {card.change}
            </p>
          </div>
        ))}
      </div>

      <div className={`${cardBg} border rounded-xl overflow-hidden`}>
        <div className={`px-5 py-4 border-b ${tableBorder} flex items-center justify-between`}>
          <h3 className={`${headingColor} font-medium text-sm`}>Recent Protocols</h3>
          <span className={`text-xs ${tableHeader}`}>Last updated</span>
        </div>
        <div className={`divide-y ${rowDivide}`}>
          {RECENT_PROTOCOLS.map((p, i) => (
            <div key={i} className={`px-5 py-3.5 flex items-center justify-between ${rowHover} transition-colors`}>
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  p.status === 'Active' ? 'bg-blue-400' : 'bg-amber-400'
                }`} />
                <div>
                  <p className={`${protocolName} text-sm font-medium`}>{p.name}</p>
                  <p className={`${protocolCat} text-xs mt-0.5`}>{p.category}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-4">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  p.status === 'Active'
                    ? 'text-blue-500 bg-blue-500/10 border-blue-500/20'
                    : 'text-amber-500 bg-amber-500/10 border-amber-500/20'
                }`}>
                  {p.status}
                </span>
                <p className={`${lastUpdated} text-xs mt-1`}>{p.updated}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  const { user } = useAuth();
  const isLight = theme === 'light';
  const cardClass = isLight ? 'bg-[#f5f7fa] border-[#e2e8ee]' : 'bg-[#0d1118] border-white/8';
  const inputClass = isLight
    ? 'bg-white border-[#d8dfe8] text-[#1a1f28] placeholder-[#374152]/25 focus:border-[#4a6fa5]/60'
    : 'bg-[#131a22] border-white/[0.08] text-white placeholder-[#d2d7e0]/25 focus:border-[#4a6fa5]/60';

  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [timezone, setTimezone] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    if (!user) return;
    const metadata = user.user_metadata ?? {};
    setFullName((metadata.full_name as string) ?? '');
    setTitle((metadata.title as string) ?? '');
    setTimezone((metadata.timezone as string) ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [user]);

  const handleProfileSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileError('');
    setProfileMessage('');
    setProfileSaving(true);

    const { error } = await supabase.auth.updateUser({
      data: {
        full_name: fullName.trim(),
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

  const handlePasswordSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordMessage('');

    if (!user?.email) {
      setPasswordError('No account email found for this user.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    setPasswordSaving(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (signInError) {
      setPasswordSaving(false);
      setPasswordError('Current password is incorrect.');
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });
    setPasswordSaving(false);

    if (updateError) {
      setPasswordError(updateError.message);
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordMessage('Password updated.');
  };

  const navItems: Array<{ id: SettingsSection; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
    { id: 'account', label: 'Account', icon: UserCircle2 },
    { id: 'security', label: 'Security', icon: Shield },
  ];

  const renderSectionContent = () => {
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
                  <label className={`${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'} text-xs block mb-1.5`}>Full name</label>
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
                    placeholder="Your name"
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
                  <input
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
                    placeholder="America/Phoenix"
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

          <section className={`${cardClass} border rounded-xl p-5`}>
            <div className="flex items-center gap-2 mb-4">
              <KeyRound size={16} className="text-[#6e8fb5]" />
              <h3 className={`${isLight ? 'text-[#1a1f28]' : 'text-white'} font-medium text-sm`}>Password</h3>
            </div>

            <form className="space-y-4" onSubmit={handlePasswordSave}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
                  placeholder="Current password"
                  required
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
                  placeholder="New password"
                  required
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors ${inputClass}`}
                  placeholder="Confirm new password"
                  required
                />
              </div>

              {passwordError && <p className="text-sm text-red-500">{passwordError}</p>}
              {passwordMessage && <p className="text-sm text-blue-500">{passwordMessage}</p>}

              <button
                type="submit"
                disabled={passwordSaving}
                className="px-4 py-2 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-colors disabled:opacity-50"
              >
                {passwordSaving ? 'Updating...' : 'Change password'}
              </button>
            </form>
          </section>
        </div>
      );
    }

    return (
      <section className={`${cardClass} border rounded-xl p-5`}>
        <div className="flex items-center gap-2 mb-2">
          <Shield size={16} className="text-[#6e8fb5]" />
          <h3 className={`${isLight ? 'text-[#1a1f28]' : 'text-white'} font-medium text-sm`}>Security</h3>
        </div>
        <p className={`${isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'} text-sm`}>
          Security controls are being rolled out in phases. Next up: active sessions, sign-out-all-devices, and audit history.
        </p>
      </section>
    );
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
  const isLight = theme === 'light';
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
      // Audit Mode tabs (kept as-is for now)
      case 'audit-overview':
        return <OverviewTab />;
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
      case 'overview':
        return <TodayTab />;
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
            <KnowledgeBase />
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
            <DashboardChat
              messages={chatMessages}
              setMessages={setChatMessages}
              selectedDocIds={chatSelectedDocIds}
              setSelectedDocIds={setChatSelectedDocIds}
            />
          </ProtocolRequiredGate>
        );
      // Shared
      case 'reports':
        return <PlaceholderTab label="Reports" />;
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

  return (
    <div className={`h-screen ${pageBg} pt-16 flex flex-col overflow-hidden`}>
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
                  <Icon size={15} className={isActive ? 'text-[#6e8fb5]' : ''} />
                  {tab.label}
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
