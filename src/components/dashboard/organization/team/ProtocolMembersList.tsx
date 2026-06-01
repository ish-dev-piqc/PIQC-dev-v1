import { useCallback, useEffect, useState } from 'react';
import { Crown, Loader2, Trash2, User as UserIcon, Users } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useOrg } from '../../../../context/OrgContext';
import {
  currentUserIsOrgAdmin,
  listOrgMembersWithProfile,
  listProtocolMembers,
  removeProtocolMember,
  updateProtocolMemberRole,
} from '../../../../lib/orgs/orgsApi';
import type {
  OrgMemberWithProfile,
  ProtocolMember,
  ProtocolMemberRole,
} from '../../../../types/orgs';

// =============================================================================
// ProtocolMembersList — PIQC access list for a single protocol.
//
// Reads from `protocol_members`. Joins with org_members_with_profile to
// surface names + org-level role (so we can show the admin crown). Site
// administrators have implicit access org-wide and are surfaced with a
// distinct "Admin (implicit)" indicator instead of a regular row, since
// they don't have a corresponding protocol_members row.
//
// Admins get inline role change + Remove. Non-admins see a read-only list.
//
// Distinct from TeamTab.tsx — that one reads site_team_members (the
// clinical-trial delegation log with cert dates and TeamRole). This one
// is about PIQC app-level access.
// =============================================================================

const ROLE_LABEL: Record<ProtocolMemberRole, string> = {
  coordinator: 'Coordinator',
  member: 'Team member',
  viewer: 'Viewer',
};

interface ProtocolMembersListProps {
  protocolId: string;
}

interface JoinedMember {
  userId: string;
  name: string;
  email: string;
  orgRole: 'admin' | 'member';
  // null when the user is an org admin (implicit access, no protocol_members row).
  protocolRole: ProtocolMemberRole | null;
}

export default function ProtocolMembersList({ protocolId }: ProtocolMembersListProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { activeOrg } = useOrg();

  const [members, setMembers] = useState<JoinedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeOrg) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [protoResult, orgResult, adminFlag] = await Promise.all([
      listProtocolMembers(protocolId),
      listOrgMembersWithProfile(activeOrg.id),
      currentUserIsOrgAdmin(activeOrg.id),
    ]);

    if (!protoResult.ok) {
      setError(protoResult.error);
      setLoading(false);
      return;
    }
    if (!orgResult.ok) {
      setError(orgResult.error);
      setLoading(false);
      return;
    }

    setIsAdmin(adminFlag);

    const orgByUserId = new Map<string, OrgMemberWithProfile>();
    for (const m of orgResult.data) orgByUserId.set(m.user_id, m);

    const protocolByUserId = new Map<string, ProtocolMember>();
    for (const p of protoResult.data) protocolByUserId.set(p.user_id, p);

    const joined: JoinedMember[] = [];

    // Admins first (implicit access).
    for (const m of orgResult.data) {
      if (m.role !== 'admin') continue;
      joined.push({
        userId: m.user_id,
        name: m.name,
        email: m.email ?? '',
        orgRole: 'admin',
        protocolRole: null,
      });
    }

    // Then explicit protocol_members rows.
    for (const p of protoResult.data) {
      const org = orgByUserId.get(p.user_id);
      // Skip if this user is already in the admin list above.
      if (org?.role === 'admin') continue;
      joined.push({
        userId: p.user_id,
        name: org?.name ?? 'Unknown user',
        email: org?.email ?? '',
        orgRole: 'member',
        protocolRole: p.role,
      });
    }

    setMembers(joined);
    setLoading(false);
  }, [protocolId, activeOrg]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleRoleChange(userId: string, role: ProtocolMemberRole) {
    setBusyUserId(userId);
    const res = await updateProtocolMemberRole(protocolId, userId, { role });
    setBusyUserId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    refresh();
  }

  async function handleRemove(member: JoinedMember) {
    if (!window.confirm(`Remove ${member.name} from this protocol?`)) return;
    setBusyUserId(member.userId);
    const res = await removeProtocolMember(protocolId, member.userId);
    setBusyUserId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    refresh();
  }

  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const labelColor = 'text-fg-label';
  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';

  if (loading) {
    return <p className={`${subColor} text-sm`}>Loading PIQC team…</p>;
  }

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h3 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5`}>
            <Users size={11} />
            PIQC team ({members.length})
          </h3>
          <p className={`${subColor} text-xs mt-1 max-w-2xl leading-relaxed`}>
            These users can see and collaborate on this protocol inside PIQC. Site administrators
            have implicit access to every protocol in the organization.
          </p>
        </div>
      </div>

      {error && (
        <div className={`px-3 py-2 rounded-md text-xs ${isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'}`}>
          {error}
        </div>
      )}

      {members.length === 0 ? (
        <div className={`px-4 py-6 rounded-md border ${border} text-center`}>
          <p className={`${subColor} text-xs`}>
            No PIQC users on this protocol yet.{' '}
            {isAdmin && <span>Use the Manage tab to add members.</span>}
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {members.map((m) => (
            <li
              key={m.userId}
              className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border ${border} flex-wrap`}
            >
              <div className="min-w-0 flex items-center gap-2 flex-1">
                {m.orgRole === 'admin' ? (
                  <Crown
                    size={13}
                    className={isLight ? 'text-amber-600' : 'text-amber-400'}
                  />
                ) : (
                  <UserIcon size={13} className={mutedColor} />
                )}
                <div className="min-w-0">
                  <p className={`${headingColor} text-sm font-medium truncate`}>{m.name}</p>
                  {m.email && (
                    <p className={`${mutedColor} text-[11px] truncate`}>{m.email}</p>
                  )}
                </div>
                {m.orgRole === 'admin' ? (
                  <span
                    className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      isLight ? 'bg-amber-100 text-amber-800' : 'bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    Admin (implicit)
                  </span>
                ) : (
                  m.protocolRole && (
                    <span
                      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        isLight
                          ? 'bg-brand-600/10 text-brand-600'
                          : 'bg-brand-600/20 text-brand-300'
                      }`}
                    >
                      {ROLE_LABEL[m.protocolRole]}
                    </span>
                  )
                )}
              </div>

              {isAdmin && m.orgRole !== 'admin' && m.protocolRole && (
                <div className="flex items-center gap-1.5">
                  <select
                    value={m.protocolRole}
                    onChange={(e) =>
                      handleRoleChange(m.userId, e.target.value as ProtocolMemberRole)
                    }
                    disabled={busyUserId === m.userId}
                    className={`text-[11px] rounded border px-1.5 py-0.5 ${inputBg} ${headingColor} max-w-[140px]`}
                  >
                    <option value="coordinator">Coordinator</option>
                    <option value="member">Team member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleRemove(m)}
                    disabled={busyUserId === m.userId}
                    className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded ${
                      isLight ? 'text-red-600 hover:bg-red-500/[0.06]' : 'text-red-400 hover:bg-red-500/[0.08]'
                    } disabled:opacity-50`}
                    aria-label={`Remove ${m.name} from protocol`}
                  >
                    {busyUserId === m.userId ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Trash2 size={11} />
                    )}
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
