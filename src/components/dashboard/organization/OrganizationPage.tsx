import { useState } from 'react';
import { Crown, User as UserIcon, Users as UsersIcon, ClipboardList } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOrg } from '../../../context/OrgContext';
import MembersTab from './MembersTab';
// Team tab still lives in dashboard/site/ for now; relocating to
// dashboard/organization/team/ is a follow-up cleanup PR (sandbox `git mv`
// limitations during this PR forced the deferral).
import TeamTab from '../site/TeamTab';

// =============================================================================
// OrganizationPage — top-level dashboard tab that absorbs the org settings
// surface and the protocol-team management that used to live under Site Mode.
//
// Tabs (v1):
//   - Members  : org-wide roster, invite form, pending invites
//   - Team     : protocol-scoped team (site_team_members), uses the navbar's
//                active protocol selection. Future: in-page picker that
//                doesn't affect the global active-protocol state.
//
// Future tabs (PR 2+): Chat, Activity log, Settings.
// =============================================================================

type OrgTab = 'members' | 'team';

const TABS: { id: OrgTab; label: string; icon: typeof UsersIcon }[] = [
  { id: 'members', label: 'Members', icon: UsersIcon },
  { id: 'team', label: 'Team', icon: ClipboardList },
];

export default function OrganizationPage() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { activeOrg } = useOrg();
  const [activeTab, setActiveTab] = useState<OrgTab>('members');

  const headerBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const subColor = 'text-fg-sub';
  const labelColor = 'text-fg-label';

  return (
    <div className="min-h-full">
      {/* Page header */}
      <div className={`${headerBg} border-b ${border} px-6 py-4`}>
        <div className="flex items-center gap-3">
          <UsersIcon size={20} className={isLight ? 'text-brand-600' : 'text-brand-300'} />
          <div>
            <h1 className="text-fg-heading text-lg font-semibold">
              {activeOrg?.name ?? 'Organization'}
            </h1>
            {activeOrg && (
              <p className={`${subColor} text-xs mt-0.5 flex items-center gap-1.5`}>
                {activeOrg.my_role === 'admin' ? (
                  <Crown size={11} className={isLight ? 'text-amber-600' : 'text-amber-400'} />
                ) : (
                  <UserIcon size={11} className="text-fg-muted" />
                )}
                {activeOrg.my_role === 'admin' ? 'Site administrator' : 'Site member'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div className={`${headerBg} border-b ${border} px-6`}>
        <div className="flex items-center gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
                  active
                    ? isLight
                      ? 'text-brand-600'
                      : 'text-brand-300'
                    : `${labelColor} hover:text-fg-body`
                }`}
              >
                <Icon size={13} />
                {t.label}
                {active && (
                  <span
                    className={`absolute bottom-0 left-2 right-2 h-0.5 ${
                      isLight ? 'bg-brand-600' : 'bg-brand-300'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active tab content */}
      <div className="px-6 py-5">
        {activeTab === 'members' && <MembersTab />}
        {activeTab === 'team' && <TeamTab />}
      </div>
    </div>
  );
}
