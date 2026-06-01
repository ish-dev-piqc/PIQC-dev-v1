import { useState } from 'react';
import {
  ArrowLeft,
  Building2,
  ClipboardList,
  Crown,
  User as UserIcon,
  Users as UsersIcon,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOrg } from '../../../context/OrgContext';
import { useProtocol } from '../../../context/ProtocolContext';
import MembersTab from './MembersTab';
// Team tab still lives in dashboard/site/ for now; relocating to
// dashboard/organization/team/ is a follow-up cleanup PR (sandbox `git mv`
// limitations during PR 1 forced the deferral).
import TeamTab from '../site/TeamTab';

// =============================================================================
// OrganizationPage — full-screen Organization destination.
//
// Renders its own chrome row (back-to-dashboard arrow + tab pills) in place
// of the standard Site/Audit tab strip; the parent Dashboard skips its tab
// strip + bordered panel when the active tab is 'organization' (see
// Dashboard.tsx early-return). The page header below the chrome row makes
// the org context unambiguous: "Organization" eyebrow, org name as the
// title, role badge underneath.
//
// Each tab inside the page is responsible for its own scope-clarity copy
// (Members → "Organization members"; Team → "Protocol team — {code}") so
// users always know whether the action they're about to take affects the
// whole org or just the active protocol.
// =============================================================================

interface OrganizationPageProps {
  onExit?: () => void;
}

type OrgTab = 'members' | 'team';

const TABS: { id: OrgTab; label: string; icon: typeof UsersIcon }[] = [
  { id: 'members', label: 'Members', icon: UsersIcon },
  { id: 'team', label: 'Team', icon: ClipboardList },
];

export default function OrganizationPage({ onExit }: OrganizationPageProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { activeOrg } = useOrg();
  const { activeProtocol } = useProtocol();
  const [activeTab, setActiveTab] = useState<OrgTab>('members');

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
            {TABS.map((t) => {
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
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                  <ClipboardList size={11} />
                  Protocol team
                  {activeProtocol && (
                    <span className="text-fg-muted normal-case tracking-normal font-normal">
                      — {activeProtocol.code}
                    </span>
                  )}
                </div>
                <p className="text-fg-sub text-xs mt-1 max-w-2xl leading-relaxed">
                  These users are assigned to {activeProtocol ? `${activeProtocol.code}` : 'the active protocol'} specifically.
                  To add a brand-new person to the whole organization, switch to the{' '}
                  <button
                    type="button"
                    onClick={() => setActiveTab('members')}
                    className="text-brand-300 hover:underline"
                  >
                    Members tab
                  </button>
                  {' '}instead.
                </p>
              </div>
              {activeProtocol ? (
                <TeamTab />
              ) : (
                <div className={`px-4 py-8 rounded-md border ${headerBorder} text-center`}>
                  <p className="text-fg-body text-sm">No protocol selected.</p>
                  <p className="text-fg-sub text-xs mt-1">
                    Pick a protocol in the top-bar protocol picker to view and edit its team.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
