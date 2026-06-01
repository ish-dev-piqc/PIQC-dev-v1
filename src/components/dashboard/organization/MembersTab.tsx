import { useCallback, useEffect, useState } from 'react';
import { Crown, User as UserIcon, AlertTriangle, Info } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useDemoMode } from '../../../context/DemoModeContext';
import {
  currentUserIsOrgAdmin,
  fetchCurrentUserOrg,
  listOrgMembersWithProfile,
} from '../../../lib/orgs/orgsApi';
import type { OrgMemberWithProfile, OrgRow } from '../../../types/orgs';

// =============================================================================
// MembersTab — read-only org roster.
//
// Anyone in the org can see who else is in the org and what their org-level
// role is. All administrative actions (invite, remove, role change, protocol
// access) live in ManageTab and are admin-only. Splitting the read view from
// the write view keeps the read surface low-friction for everyone and avoids
// surfacing controls that non-admins can't use.
// =============================================================================

export default function MembersTab() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { demoActive } = useDemoMode();

  const [org, setOrg] = useState<OrgRow | null>(null);
  const [members, setMembers] = useState<OrgMemberWithProfile[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const orgResult = await fetchCurrentUserOrg();
    if (!orgResult.ok) {
      setError(orgResult.error);
      setLoading(false);
      return;
    }
    if (!orgResult.data) {
      setOrg(null);
      setLoading(false);
      return;
    }
    setOrg(orgResult.data);
    const [membersResult, adminFlag] = await Promise.all([
      listOrgMembersWithProfile(orgResult.data.id),
      currentUserIsOrgAdmin(orgResult.data.id),
    ]);
    if (!membersResult.ok) setError(membersResult.error);
    setMembers(membersResult.ok ? membersResult.data : []);
    setIsAdmin(adminFlag);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (demoActive) {
      setLoading(false);
      return;
    }
    refresh();
  }, [refresh, demoActive]);

  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const headingColor = 'text-fg-heading';
  const labelColor = 'text-fg-label';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const infoBg = isLight
    ? 'bg-brand-600/[0.04] border-brand-600/20 text-brand-600'
    : 'bg-brand-600/[0.08] border-brand-600/30 text-brand-300';

  if (demoActive) {
    return (
      <div className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs ${isLight ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-amber-500/[0.06] border border-amber-500/20 text-amber-300'}`}>
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <p>Demo mode — org membership is local-only and doesn't reflect any real Supabase data.</p>
      </div>
    );
  }

  if (loading) {
    return <p className={`${subColor} text-sm`}>Loading…</p>;
  }

  if (!org) {
    return (
      <div>
        <p className={`${headingColor} text-sm`}>No organization linked to your profile.</p>
        <p className={`${subColor} text-xs mt-2 leading-relaxed max-w-md`}>
          Update your organization name on your profile to be added to a matching org or create
          a new one.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      {error && (
        <div className={`px-4 py-3 rounded-md text-xs ${isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'}`}>
          {error}
        </div>
      )}

      {isAdmin && (
        <div className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs ${infoBg}`}>
          <Info size={13} className="mt-0.5 flex-shrink-0" />
          <p className="leading-relaxed">
            To invite, remove, or manage protocol access, use the{' '}
            <span className="font-semibold">Manage</span> tab.
          </p>
        </div>
      )}

      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
            Organization members ({members.length})
          </h3>
        </div>
        <p className={`${subColor} text-xs mb-3 max-w-2xl leading-relaxed`}>
          These users have access to the whole organization. To see who's on a specific protocol,
          switch to the Team tab.
        </p>
        <ul className="space-y-1.5">
          {members.map((m) => (
            <li
              key={m.user_id}
              className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border ${border}`}
            >
              <div className="min-w-0 flex items-center gap-2">
                {m.role === 'admin' ? (
                  <Crown size={13} className={isLight ? 'text-amber-600' : 'text-amber-400'} />
                ) : (
                  <UserIcon size={13} className={mutedColor} />
                )}
                <span className={`${headingColor} text-sm font-medium truncate`}>{m.name}</span>
                <span
                  className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    m.role === 'admin'
                      ? isLight
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-amber-500/15 text-amber-300'
                      : isLight
                        ? 'bg-[#F2F2F2] text-[#334155]/65'
                        : 'bg-white/[0.06] text-[#CBD5E1]/55'
                  }`}
                >
                  {m.role === 'admin' ? 'Site administrator' : 'Site member'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
