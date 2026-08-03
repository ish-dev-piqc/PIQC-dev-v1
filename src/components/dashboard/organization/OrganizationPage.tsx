import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Building2,
  Calendar,
  ClipboardList,
  Crown,
  Folder,
  MessageCircle,
  Settings,
  User as UserIcon,
  Users as UsersIcon,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOrg } from '../../../context/OrgContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useUnreadMentionsDisplay } from '../../../context/UnreadMentionsContext';
import MembersTab from './MembersTab';
import ManageTab from './ManageTab';
import ChatTab from './ChatTab';
import ActivityTab from './ActivityTab';
import HubTodayTab from './HubTodayTab';
import HubDocumentsTab from './HubDocumentsTab';
import UnifiedTeamList from './team/UnifiedTeamList';
import type { DashboardTab } from '../Dashboard';

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

export type OrgTab =
  | 'today'
  | 'chat'
  | 'documents'
  | 'organization'
  | 'team'
  | 'manage'
  | 'activity';

interface OrganizationPageProps {
  onExit?: () => void;
  /** Label for the back button (e.g. "Today", "Participants"). Defaults
   *  to "Dashboard" when omitted. */
  exitLabel?: string;
  /** Routed from App.tsx so mode-tile clicks inside Today can switch to
   *  the chosen dashboard tab (e.g. Protocol Intelligence → 'cra-workspace'). */
  onDashboardTabChange?: (tab: DashboardTab) => void;
}

export const ORG_TAB_STORAGE_KEY = 'piq-org-tab-v1';
const VALID_ORG_TABS: ReadonlySet<OrgTab> = new Set<OrgTab>([
  'today',
  'chat',
  'documents',
  'organization',
  'team',
  'manage',
  'activity',
]);

function readStoredOrgTab(): OrgTab | null {
  try {
    const v = localStorage.getItem(ORG_TAB_STORAGE_KEY);
    if (!v) return null;
    // Migrate the legacy 'members' key — same tab, just renamed to
    // 'organization' for clarity vs team/protocol membership.
    if (v === 'members') return 'organization';
    if (VALID_ORG_TABS.has(v as OrgTab)) return v as OrgTab;
  } catch {
    /* ignore */
  }
  return null;
}

const BASE_TABS: { id: OrgTab; label: string; icon: typeof UsersIcon }[] = [
  // Today is the new default — daily-driver landing surface for the
  // coordinator persona.
  { id: 'today', label: 'Today', icon: Calendar },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'documents', label: 'Documents', icon: Folder },
  // "Organization" rather than "Members" so the label clearly refers to
  // the org-level roster, distinct from a protocol's team membership.
  { id: 'organization', label: 'Organization', icon: UsersIcon },
  { id: 'team', label: 'Team', icon: ClipboardList },
];

export default function OrganizationPage({ onExit, exitLabel, onDashboardTabChange }: OrganizationPageProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { activeOrg } = useOrg();
  const { protocols, activeProtocol, setActiveProtocol } = useProtocol();
  const { count: unreadMentionCount, display: unreadMentionDisplay } =
    useUnreadMentionsDisplay();
  // Read from localStorage on each mount so refresh restores the last
  // sub-tab. Deep-link entry points (e.g. cert-warning band → Team) write
  // directly to localStorage in App.tsx before navigating, so the read
  // here picks up their intent without a prop being passed in.
  const [activeTab, setActiveTab] = useState<OrgTab>(
    // Today is the new default. Returning users keep their last tab via
    // the existing localStorage persistence.
    () => readStoredOrgTab() ?? 'today',
  );

  // Persist the active sub-tab so a hard refresh lands the user back on the
  // same surface (Chat, Manage, etc.) instead of bouncing them to Members.
  useEffect(() => {
    try {
      localStorage.setItem(ORG_TAB_STORAGE_KEY, activeTab);
    } catch {
      /* ignore */
    }
  }, [activeTab]);

  const isAdmin = activeOrg?.my_role === 'admin';
  // "Draft activity" + Manage are both admin-only. Tabs stay in this
  // order: Organization → Team → Chat → Draft activity → Manage so the
  // change-log surface sits adjacent to the management surfaces it
  // describes. "Draft" because the log is not a formal audit trail —
  // gaps are possible if a trigger silently fails — and we don't want
  // the label to overpromise that guarantee.
  const tabs: { id: OrgTab; label: string; icon: typeof UsersIcon }[] = isAdmin
    ? [
        ...BASE_TABS,
        { id: 'activity', label: 'Draft activity', icon: Activity },
        { id: 'manage', label: 'Manage', icon: Settings },
      ]
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
              aria-label={exitLabel ? `Back to ${exitLabel}` : 'Back'}
            >
              <ArrowLeft size={15} />
              {exitLabel ? `Back to ${exitLabel}` : 'Back'}
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
                  {t.id === 'chat' && unreadMentionCount > 0 && (
                    <span
                      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        isLight ? 'bg-amber-500 text-white' : 'bg-amber-400 text-[#0F172A]'
                      }`}
                      title={`${unreadMentionCount} unread @mention${unreadMentionCount === 1 ? '' : 's'}`}
                    >
                      {unreadMentionDisplay}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
          {/* Page header — workspace framing. Was "Organization" before the
              workspace-first refactor; relabeled so the chrome reads as
              "you're at the org's workspace" instead of "you're on the
              Organization admin page." */}
          <div className={`pb-5 mb-6 border-b ${headerBorder}`}>
            <div className="flex items-center gap-2 text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              <Building2 size={11} />
              Workspace
            </div>
            <h1 className="text-fg-heading text-2xl font-semibold mt-1">
              {activeOrg?.name ?? 'Workspace'}
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

          {activeTab === 'today' && (
            <HubTodayTab
              onChangeDashboardTab={(tab) => onDashboardTabChange?.(tab)}
            />
          )}

          {activeTab === 'documents' && <HubDocumentsTab />}

          {activeTab === 'organization' && <MembersTab />}

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

          {activeTab === 'chat' && <ChatTab />}

          {activeTab === 'activity' && isAdmin && <ActivityTab />}

          {activeTab === 'manage' && isAdmin && <ManageTab />}
        </div>
      </div>
    </div>
  );
}
