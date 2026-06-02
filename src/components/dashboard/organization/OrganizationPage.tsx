import { useState } from 'react';
import {
  ArrowLeft,
  Building2,
  ClipboardList,
  Crown,
  Settings,
  User as UserIcon,
  Users as UsersIcon,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOrg } from '../../../context/OrgContext';
import { useProtocol } from '../../../context/ProtocolContext';
import MembersTab from './MembersTab';
import ManageTab from './ManageTab';
import UnifiedTeamList from './team/UnifiedTeamList';

// =============================================================================
// OrganizationPage — full-screen Organization destination.
//
// Owns its own chrome row (back arrow + tab pills) in place of the standard
// Site/Audit tab strip; Dashboard.tsx routes here directly when activeTab is
// 'organization'.
//
// Tabs:
//   - Members  : read-only org roster (everyone)
//   - Team     : protocol-specific delegation log + in-page protocol picker.
//                The picker calls setActiveProtocol so the user's choice
//                follows them back to the dashboard when they exit.
//   - Manage   : invite + member-admin + bulk protocol-access matrix.
//                Admin-only; hidden from the tab strip for site members.
// =============================================================================

interface OrganizationPageProps {
  onExit?: () => void;
}

type OrgTab = 'members' | 'team' | 'manage';

const BASE_TABS: { id: OrgTab; label: string; icon: typeof UsersIcon }[] = [
  { id: 'members', label: 'Members', icon: UsersIcon },
  { id: 'team', label: 'Team', icon: ClipboardList },
];

export default function OrganizationPage({ onExit }: OrganizationPageProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { activeOrg } = useOrg();
  const { protocols, activeProtocol, setActiveProtocol } = useProtocol();
  const [activeTab, setActiveTab] = useState<OrgTab>('members');

  const isAdmin = activeOrg?.my_role === 'admin';
  const tabs: { id: OrgTab; label: string; icon: typeof UsersIcon }[] = isAdmin
    ? [...BASE_TABS, { id: 'manage', label: 'Manage', icon: Settings }]
    : BASE_TABS;

  const tabBarBg = isLight
    ? 'border-[#E2E8F0] bg-[#F8FAFC]/80'
    : 'border-white/5 bg-[#020617]/80';
  const activeTabClass = isLight
    ? 'text-[#0F172A] bg-white border border-[#E2E8F0]'
    : 'text-white bg-white/[0.06] border border-white/10';
  const inactiveTabClass = isLight
    ? 'text-[#334155]/40 hover:text-[#334155]/70 hover:bg-[#0F172A]/[0.03]'
    : 'text-[#CBD5E1]/40 hover:text-[#CBD5E1]/70 hover:bg-white/[0.03]';
  const headerBorder = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const exitButtonClass = isLight
    ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.05] border-[#E2E8F0]'
    : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.05] border-white/10';
  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Chrome row — back arrow + org tabs. Sits where the Site/Audit tab
          strip would normally render, so the spatial language is the same. */}
      <div className={`flex-shrink-0 border-b ${tabBarBg} backdrop-blur-sm`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-1">
            <button
              type="button"
              onClick={() => onExit?.()}
              className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-lg border transition-all duration-150 whitespace-nowrap ${exitButtonClass}`}
              aria-label="Back to dashboard"
            >
              <ArrowLeft size={15} />
              Dashboard
            </button>
            <div className={`w-px h-6 mx-1 ${isLight ? 'bg-[#E2E8F0]' : 'bg-white/10'}`} />
            {tabs.map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-150 whitespace-nowrap ${
                    isActive ? activeTabClass : inactiveTabClass
                  }`}
                >
                  <Icon size={15} className={isActive ? 'text-brand-300' : ''} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
          {/* Page header — clear org framing */}
          <div className={`pb-5 mb-6 border-b ${headerBorder}`}>
            <div className="flex items-center gap-2 text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              <Building2 size={11} />
              Organization
            </div>
            <h1 className="text-fg-heading text-2xl font-semibold mt-1">
              {activeOrg?.name ?? 'Organization'}
            </h1>
            {activeOrg && (
              <p className="text-fg-sub text-xs mt-2 flex items-center gap-1.5">
                {activeOrg.my_role === 'admin' ? (
                  <Crown size={11} className={isLight ? 'text-amber-600' : 'text-amber-400'} />
                ) : (
                  <UserIcon size={11} className="text-fg-muted" />
                )}
                {activeOrg.my_role === 'admin' ? 'Site administrator' : 'Site member'}
              </p>
            )}
          </div>

          {activeTab === 'members' && <MembersTab />}

          {activeTab === 'team' && (
            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                  <ClipboardList size={11} />
                  Protocol team
                </div>
                <p className="text-fg-sub text-xs mt-1 max-w-2xl leading-relaxed">
                  Pick a protocol to see who's working on it. Adding or removing PIQC access
                  happens in the{' '}
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => setActiveTab('manage')}
                      className="text-brand-300 hover:underline"
                    >
                      Manage tab
                    </button>
                  ) : (
                    'Manage tab (admins only)'
                  )}
                  .
                </p>
              </div>
              {/* Picker — flex-wrap so the select drops below the label on narrow
                  viewports instead of overflowing the page. Caps width so the
                  selected option's text truncates rather than stretching. */}
              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="org-team-protocol-picker"
                  className="text-fg-label text-[11px] uppercase tracking-wider font-semibold flex-shrink-0"
                >
                  Protocol
                </label>
                <select
                  id="org-team-protocol-picker"
                  value={activeProtocol?.id ?? ''}
                  onChange={(e) => {
                    const next = protocols.find((p) => p.id === e.target.value);
                    setActiveProtocol(next ?? null);
                  }}
                  className={`text-xs rounded-md border px-2 py-1.5 ${inputBg} text-fg-heading focus:outline-none focus:ring-2 focus:ring-brand-600/30 w-full sm:w-auto sm:max-w-[320px] min-w-0 truncate`}
                >
                  <option value="">— Select a protocol —</option>
                  {protocols.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {activeProtocol ? (
                <UnifiedTeamList protocolId={activeProtocol.id} />
              ) : (
                <div className={`px-4 py-8 rounded-md border ${headerBorder} text-center`}>
                  <p className="text-fg-body text-sm">No protocol selected.</p>
                  <p className="text-fg-sub text-xs mt-1">
                    Pick a protocol from the dropdown above to view its team.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'manage' && isAdmin && <ManageTab />}
        </div>
      </div>
    </div>
  );
}
