import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Crown,
  Loader2,
  MoreHorizontal,
  Trash2,
  User as UserIcon,
  Edit,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useOrg } from '../../../../context/OrgContext';
import { useSiteData } from '../../../../context/SiteDataContext';
import {
  addProtocolMember,
  currentUserIsOrgAdmin,
  listOrgMembersWithProfile,
  listProtocolMembers,
  removeProtocolMember,
  updateProtocolMemberRole,
} from '../../../../lib/orgs/orgsApi';
import { deleteTeamMember } from '../../../../lib/site/siteApi';
import { isCertExpired, isCertExpiringSoon } from '../../../../lib/site/dateUtils';
import { TEAM_ROLE_SHORT, TEAM_ROLE_LABELS } from '../../../../lib/site/labels';
import TeamFormDrawer from './TeamFormDrawer';
import type {
  OrgMemberWithProfile,
  ProtocolMember,
  ProtocolMemberRole,
} from '../../../../types/orgs';
import type { SiteTeamMember } from '../../../../lib/site/types';

// =============================================================================
// UnifiedTeamList — one row per person on the active protocol, merging
// `protocol_members` (PIQC access) and `site_team_members` (clinical
// delegation log) into a single view. Joins by email since the two tables
// don't share a foreign key; org_members_with_profile bridges user_id →
// email + name.
//
// Each row carries up to two badges:
//   - PIQC role     (Coordinator / Team member / Viewer / Admin (implicit) / —)
//   - Clinical role (PI / SUB_I / COORDINATOR / NURSE / PHARMACIST / MONITOR / —)
//
// Admins get inline editing on both. Changing the PIQC role triggers a
// confirm modal. Changing the clinical role opens TeamFormDrawer (existing
// edit flow; create flow newly enabled in this PR's TeamFormDrawer edit).
// =============================================================================

const PIQC_ROLE_LABEL: Record<ProtocolMemberRole, string> = {
  coordinator: 'Coordinator',
  member: 'Team member',
  viewer: 'Viewer',
};

interface UnifiedTeamListProps {
  protocolId: string;
}

interface UnifiedRow {
  key: string;
  name: string;
  email: string;
  // userId is null only for delegation-log-only rows where the email doesn't
  // match any org member. Those rows can't have PIQC actions invoked.
  userId: string | null;
  orgRole: 'admin' | 'member' | null;
  piqcRole: ProtocolMemberRole | null;
  isAdminImplicit: boolean;
  siteMember: SiteTeamMember | null;
}

type PiqcChange = {
  userId: string;
  name: string;
  from: ProtocolMemberRole | null; // null = adding fresh
  to: ProtocolMemberRole;
};

export default function UnifiedTeamList({ protocolId }: UnifiedTeamListProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { activeOrg } = useOrg();
  const { teamMembers: allTeam } = useSiteData();

  const [piqcMembers, setPiqcMembers] = useState<ProtocolMember[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMemberWithProfile[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const [piqcConfirm, setPiqcConfirm] = useState<PiqcChange | null>(null);
  const [drawer, setDrawer] = useState<{
    mode: 'create' | 'edit';
    initial?: SiteTeamMember;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!activeOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [piqc, org, admin] = await Promise.all([
      listProtocolMembers(protocolId),
      listOrgMembersWithProfile(activeOrg.id),
      currentUserIsOrgAdmin(activeOrg.id),
    ]);
    if (!piqc.ok) {
      setError(piqc.error);
      setLoading(false);
      return;
    }
    if (!org.ok) {
      setError(org.error);
      setLoading(false);
      return;
    }
    setPiqcMembers(piqc.data);
    setOrgMembers(org.data);
    setIsAdmin(admin);
    setLoading(false);
  }, [protocolId, activeOrg]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Delegation log scoped to this protocol — useSiteData stores all team
  // members across protocols, so filter here.
  const siteTeam = useMemo(
    () => allTeam.filter((m) => m.protocol_id === protocolId),
    [allTeam, protocolId],
  );

  const unifiedRows: UnifiedRow[] = useMemo(() => {
    const orgByUserId = new Map<string, OrgMemberWithProfile>();
    const orgByEmail = new Map<string, OrgMemberWithProfile>();
    for (const o of orgMembers) {
      orgByUserId.set(o.user_id, o);
      if (o.email) orgByEmail.set(o.email.toLowerCase(), o);
    }

    const rows: UnifiedRow[] = [];
    const handledEmails = new Set<string>();
    const handledUserIds = new Set<string>();

    function findSiteMemberByEmail(email: string): SiteTeamMember | null {
      if (!email) return null;
      const k = email.toLowerCase();
      return siteTeam.find((s) => (s.email ?? '').toLowerCase() === k) ?? null;
    }

    // 1. Org admins always appear (implicit PIQC access org-wide).
    for (const o of orgMembers) {
      if (o.role !== 'admin') continue;
      const site = findSiteMemberByEmail(o.email ?? '');
      rows.push({
        key: o.user_id,
        name: o.name,
        email: o.email ?? '',
        userId: o.user_id,
        orgRole: 'admin',
        piqcRole: null,
        isAdminImplicit: true,
        siteMember: site,
      });
      handledUserIds.add(o.user_id);
      if (o.email) handledEmails.add(o.email.toLowerCase());
    }

    // 2. Non-admin org members with explicit protocol_members rows.
    for (const p of piqcMembers) {
      if (handledUserIds.has(p.user_id)) continue;
      const org = orgByUserId.get(p.user_id);
      const site = findSiteMemberByEmail(org?.email ?? '');
      rows.push({
        key: p.user_id,
        name: org?.name ?? 'Unknown user',
        email: org?.email ?? '',
        userId: p.user_id,
        orgRole: org?.role ?? null,
        piqcRole: p.role,
        isAdminImplicit: false,
        siteMember: site,
      });
      handledUserIds.add(p.user_id);
      if (org?.email) handledEmails.add(org.email.toLowerCase());
    }

    // 3. Delegation-log-only rows (clinical role, no PIQC access).
    for (const s of siteTeam) {
      const emailKey = (s.email ?? '').toLowerCase();
      if (emailKey && handledEmails.has(emailKey)) continue;
      const org = emailKey ? orgByEmail.get(emailKey) ?? null : null;
      rows.push({
        key: `site-${s.id}`,
        name: s.name,
        email: s.email ?? '',
        userId: org?.user_id ?? null,
        orgRole: org?.role ?? null,
        piqcRole: null,
        isAdminImplicit: org?.role === 'admin',
        siteMember: s,
      });
    }

    return rows;
  }, [orgMembers, piqcMembers, siteTeam]);

  function requestPiqcChange(row: UnifiedRow, target: ProtocolMemberRole) {
    if (!row.userId) return;
    if (row.piqcRole === target) return;
    if (row.isAdminImplicit) return;
    setPiqcConfirm({
      userId: row.userId,
      name: row.name,
      from: row.piqcRole,
      to: target,
    });
  }

  async function confirmPiqcChange() {
    if (!piqcConfirm) return;
    const { userId, from, to } = piqcConfirm;
    setBusy(userId);
    const result =
      from === null
        ? await addProtocolMember({ protocol_id: protocolId, user_id: userId, role: to })
        : await updateProtocolMemberRole(protocolId, userId, { role: to });
    setBusy(null);
    setPiqcConfirm(null);
    if (!result.ok) setError(result.error);
    refresh();
  }

  async function handleRemovePiqc(row: UnifiedRow) {
    if (!row.userId || row.piqcRole === null) return;
    if (!window.confirm(`Remove ${row.name}'s PIQC access to this protocol?`)) return;
    setBusy(row.userId);
    setOpenMenu(null);
    const result = await removeProtocolMember(protocolId, row.userId);
    setBusy(null);
    if (!result.ok) setError(result.error);
    refresh();
  }

  async function handleRemoveClinical(row: UnifiedRow) {
    if (!row.siteMember) return;
    if (
      !window.confirm(`Remove ${row.name} from the delegation log for this protocol?`)
    )
      return;
    setBusy(row.key);
    setOpenMenu(null);
    const result = await deleteTeamMember(row.siteMember.id);
    setBusy(null);
    if (!result.ok) setError(result.error);
    refresh();
  }

  function openClinicalEditor(row: UnifiedRow) {
    setOpenMenu(null);
    setDrawer({
      mode: row.siteMember ? 'edit' : 'create',
      initial: row.siteMember ?? undefined,
    });
  }

  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-brand-600/50'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-brand-300/50';
  const buttonGhost = isLight
    ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.05]'
    : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.05]';

  // Badge style for PIQC role badge — switches between display and an inline
  // select for admins on non-admin rows.
  function piqcBadge(row: UnifiedRow) {
    if (row.isAdminImplicit) {
      return (
        <span
          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
            isLight ? 'bg-amber-100 text-amber-800' : 'bg-amber-500/15 text-amber-300'
          }`}
        >
          Admin (implicit)
        </span>
      );
    }
    if (row.piqcRole === null) {
      // No PIQC access — if admin and the row has a userId, surface an add
      // affordance; otherwise just show "—".
      if (isAdmin && row.userId) {
        return (
          <select
            value=""
            onChange={(e) =>
              requestPiqcChange(row, e.target.value as ProtocolMemberRole)
            }
            className={`text-[11px] rounded border px-1.5 py-0.5 ${inputBg} ${mutedColor}`}
            disabled={busy === row.userId}
          >
            <option value="" disabled>
              + PIQC access
            </option>
            <option value="coordinator">Coordinator</option>
            <option value="member">Team member</option>
            <option value="viewer">Viewer</option>
          </select>
        );
      }
      return (
        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${mutedColor}`}>—</span>
      );
    }
    if (isAdmin && row.userId) {
      return (
        <select
          value={row.piqcRole}
          onChange={(e) =>
            requestPiqcChange(row, e.target.value as ProtocolMemberRole)
          }
          className={`text-[11px] rounded border px-1.5 py-0.5 ${inputBg} ${headingColor}`}
          disabled={busy === row.userId}
          aria-label={`PIQC role for ${row.name}`}
        >
          <option value="coordinator">Coordinator</option>
          <option value="member">Team member</option>
          <option value="viewer">Viewer</option>
        </select>
      );
    }
    return (
      <span
        className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
          isLight ? 'bg-brand-600/10 text-brand-600' : 'bg-brand-600/20 text-brand-300'
        }`}
      >
        {PIQC_ROLE_LABEL[row.piqcRole]}
      </span>
    );
  }

  function clinicalBadge(row: UnifiedRow) {
    if (!row.siteMember) {
      if (isAdmin) {
        return (
          <button
            type="button"
            onClick={() => openClinicalEditor(row)}
            className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-dashed ${mutedColor} hover:${headingColor} ${border}`}
            aria-label={`Add clinical role for ${row.name}`}
          >
            <Plus size={10} />
            Clinical role
          </button>
        );
      }
      return (
        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${mutedColor}`}>
          Not in delegation log
        </span>
      );
    }
    const certExpired = isCertExpired(row.siteMember.certified_through);
    const certExpiring = !certExpired && isCertExpiringSoon(row.siteMember.certified_through);
    const clinicalTone = isLight
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => (isAdmin ? openClinicalEditor(row) : undefined)}
          disabled={!isAdmin}
          className={`inline-flex items-center text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${clinicalTone} ${isAdmin ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
          title={TEAM_ROLE_LABELS[row.siteMember.role]}
        >
          {TEAM_ROLE_SHORT[row.siteMember.role]}
        </button>
        {(certExpired || certExpiring) && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${
              certExpired
                ? isLight
                  ? 'bg-rose-50 text-rose-700'
                  : 'bg-rose-500/15 text-rose-300'
                : isLight
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-amber-500/15 text-amber-300'
            }`}
            title={`Cert ${certExpired ? 'expired' : 'expiring'}: ${row.siteMember.certified_through}`}
          >
            <AlertTriangle size={9} />
            {certExpired ? 'Expired' : 'Expiring'}
          </span>
        )}
      </div>
    );
  }

  if (loading) {
    return <p className={`${subColor} text-sm`}>Loading team…</p>;
  }

  return (
    <section className="space-y-3">
      {error && (
        <div className={`px-3 py-2 rounded-md text-xs ${isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'}`}>
          {error}
        </div>
      )}

      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className={`${subColor} text-xs max-w-2xl leading-relaxed`}>
          Everyone on this protocol — PIQC users and clinical staff combined. The PIQC badge
          shows app access; the clinical badge shows the delegation log role and cert status.
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={() =>
              setDrawer({ mode: 'create', initial: undefined })
            }
            className={`inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md ${buttonPrimary}`}
          >
            <Plus size={12} />
            Add clinical staff
          </button>
        )}
      </div>

      {unifiedRows.length === 0 ? (
        <div className={`px-4 py-8 rounded-md border ${border} text-center`}>
          <p className={`${subColor} text-xs`}>
            No team on this protocol yet.
            {isAdmin && ' Use the Manage tab to add PIQC users, or "Add clinical staff" above.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {unifiedRows.map((row) => {
            const menuOpen = openMenu === row.key;
            return (
              <li
                key={row.key}
                className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border ${border} flex-wrap relative`}
              >
                <div className="min-w-0 flex items-center gap-2 flex-1">
                  {row.orgRole === 'admin' ? (
                    <Crown size={13} className={isLight ? 'text-amber-600' : 'text-amber-400'} />
                  ) : (
                    <UserIcon size={13} className={mutedColor} />
                  )}
                  <div className="min-w-0">
                    <p className={`${headingColor} text-sm font-medium truncate`}>{row.name}</p>
                    {row.email && (
                      <p className={`${mutedColor} text-[11px] truncate`}>{row.email}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {piqcBadge(row)}
                  {clinicalBadge(row)}
                </div>

                {isAdmin && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenMenu(menuOpen ? null : row.key)}
                      className={`p-1 rounded ${buttonGhost}`}
                      aria-label={`Actions for ${row.name}`}
                    >
                      {busy === row.userId || busy === row.key ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <MoreHorizontal size={13} />
                      )}
                    </button>
                    {menuOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setOpenMenu(null)}
                          aria-hidden="true"
                        />
                        <div
                          className={`absolute right-0 top-full mt-1 z-20 min-w-[200px] rounded-md border ${border} ${isLight ? 'bg-white' : 'bg-[#0F172A]'} shadow-lg py-1`}
                        >
                          {row.siteMember ? (
                            <button
                              type="button"
                              onClick={() => openClinicalEditor(row)}
                              className={`w-full inline-flex items-center gap-2 text-xs px-3 py-1.5 ${buttonGhost}`}
                            >
                              <Edit size={11} />
                              Edit clinical role
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openClinicalEditor(row)}
                              className={`w-full inline-flex items-center gap-2 text-xs px-3 py-1.5 ${buttonGhost}`}
                            >
                              <Plus size={11} />
                              Add clinical role
                            </button>
                          )}
                          {row.piqcRole !== null && row.userId && (
                            <button
                              type="button"
                              onClick={() => handleRemovePiqc(row)}
                              className={`w-full inline-flex items-center gap-2 text-xs px-3 py-1.5 ${isLight ? 'text-red-600 hover:bg-red-500/[0.06]' : 'text-red-400 hover:bg-red-500/[0.08]'}`}
                            >
                              <Trash2 size={11} />
                              Remove PIQC access
                            </button>
                          )}
                          {row.siteMember && (
                            <button
                              type="button"
                              onClick={() => handleRemoveClinical(row)}
                              className={`w-full inline-flex items-center gap-2 text-xs px-3 py-1.5 ${isLight ? 'text-red-600 hover:bg-red-500/[0.06]' : 'text-red-400 hover:bg-red-500/[0.08]'}`}
                            >
                              <Trash2 size={11} />
                              Remove from delegation log
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* PIQC role-change confirmation modal */}
      {piqcConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setPiqcConfirm(null)}
            aria-hidden="true"
          />
          <div
            className={`relative max-w-sm w-full rounded-lg border shadow-xl ${
              isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10'
            }`}
          >
            <div className={`px-5 py-3 border-b ${border}`}>
              <h3 className={`${headingColor} text-sm font-semibold`}>
                {piqcConfirm.from === null ? 'Grant PIQC access?' : 'Change PIQC role?'}
              </h3>
            </div>
            <div className="px-5 py-3">
              <p className={`${subColor} text-xs leading-relaxed`}>
                {piqcConfirm.from === null ? (
                  <>
                    Grant <strong className={headingColor}>{piqcConfirm.name}</strong> PIQC
                    access to this protocol as{' '}
                    <strong className={headingColor}>{PIQC_ROLE_LABEL[piqcConfirm.to]}</strong>?
                  </>
                ) : (
                  <>
                    Change <strong className={headingColor}>{piqcConfirm.name}</strong>'s PIQC
                    role from{' '}
                    <strong className={headingColor}>{PIQC_ROLE_LABEL[piqcConfirm.from]}</strong>{' '}
                    to{' '}
                    <strong className={headingColor}>{PIQC_ROLE_LABEL[piqcConfirm.to]}</strong>?
                  </>
                )}
              </p>
            </div>
            <div className={`flex items-center justify-end gap-2 px-5 py-3 border-t ${border}`}>
              <button
                type="button"
                onClick={() => setPiqcConfirm(null)}
                className={`text-xs px-3 py-1.5 rounded-md ${buttonGhost}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmPiqcChange}
                disabled={busy === piqcConfirm.userId}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
              >
                {busy === piqcConfirm.userId && <Loader2 size={12} className="animate-spin" />}
                {piqcConfirm.from === null ? 'Grant access' : 'Change role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {drawer && (
        <TeamFormDrawer
          mode={drawer.mode}
          protocolId={protocolId}
          initial={drawer.initial}
          onClose={() => {
            setDrawer(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}
