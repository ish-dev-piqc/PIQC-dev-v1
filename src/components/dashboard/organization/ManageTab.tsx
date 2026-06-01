import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UserPlus,
  Crown,
  User as UserIcon,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  XCircle,
  Grid3x3,
  Loader2,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useDemoMode } from '../../../context/DemoModeContext';
import {
  addProtocolMember,
  buildInviteUrl,
  createOrgInvite,
  currentUserIsOrgAdmin,
  fetchCurrentUserOrg,
  listOrgInvites,
  listOrgMembersWithProfile,
  listProtocolMembers,
  listProtocolsByOrg,
  removeOrgMember,
  removeProtocolMember,
  revokeOrgInvite,
  updateOrgMemberRole,
} from '../../../lib/orgs/orgsApi';
import type {
  OrgInvite,
  OrgMemberWithProfile,
  OrgProtocolSummary,
  OrgRole,
  OrgRow,
  ProtocolAssignment,
  ProtocolMemberRole,
} from '../../../types/orgs';

// =============================================================================
// ManageTab — admin-only org administration surface. Three sections:
//
//   1. Invite to organization     (lifted from old MembersTab)
//   2. Manage members             (per-row Remove + role toggle)
//   3. Bulk protocol access       (matrix grid: members × protocols, toggle
//                                   cells, pick default role, apply in bulk)
//
// The matrix only handles add/remove. Role changes on existing memberships
// stay per-row in the Team tab via updateProtocolMemberRole; baking role
// edits into the matrix would force a three-state cell which clutters
// the "check the boxes, hit apply" mental model.
// =============================================================================

const ROLE_LABEL: Record<ProtocolMemberRole, string> = {
  coordinator: 'Coordinator',
  member: 'Team member',
  viewer: 'Viewer',
};

function cellKey(userId: string, protocolId: string): string {
  return `${userId}|${protocolId}`;
}

export default function ManageTab() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { demoActive } = useDemoMode();

  const [org, setOrg] = useState<OrgRow | null>(null);
  const [members, setMembers] = useState<OrgMemberWithProfile[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [orgProtocols, setOrgProtocols] = useState<OrgProtocolSummary[]>([]);
  const [assignments, setAssignments] = useState<Map<string, ProtocolMemberRole>>(new Map());

  // Bulk matrix
  // currentMatrix[cellKey] = role on the server (omitted if not a member)
  const [currentMatrix, setCurrentMatrix] = useState<Map<string, ProtocolMemberRole>>(new Map());
  // pendingMatrix[cellKey] = pending change. role => add at that role.
  // null => remove existing membership. Absent key => no pending change.
  const [pendingMatrix, setPendingMatrix] = useState<Map<string, ProtocolMemberRole | null>>(
    new Map(),
  );
  const [defaultBulkRole, setDefaultBulkRole] = useState<ProtocolMemberRole>('member');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

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
    const memberList = membersResult.ok ? membersResult.data : [];
    setMembers(memberList);
    setIsAdmin(adminFlag);

    if (adminFlag) {
      const [invitesResult, protocolsResult] = await Promise.all([
        listOrgInvites(orgResult.data.id),
        listProtocolsByOrg(orgResult.data.id),
      ]);
      const invList = invitesResult.ok ? invitesResult.data : [];
      const protoList = protocolsResult.ok ? protocolsResult.data : [];
      setInvites(invList);
      setOrgProtocols(protoList);

      // Build the current matrix by fetching protocol_members for each org
      // protocol in parallel. RLS limits visibility but admins can see all
      // memberships within their org.
      const memberResults = await Promise.all(
        protoList.map((p) => listProtocolMembers(p.id)),
      );
      const next = new Map<string, ProtocolMemberRole>();
      memberResults.forEach((res, idx) => {
        if (!res.ok) return;
        const protocolId = protoList[idx].id;
        for (const m of res.data) {
          next.set(cellKey(m.user_id, protocolId), m.role);
        }
      });
      setCurrentMatrix(next);
      setPendingMatrix(new Map());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (demoActive) {
      setLoading(false);
      return;
    }
    refresh();
  }, [refresh, demoActive]);

  // -------------------------------------------------------------------------
  // Invite form handlers (parity with the old MembersTab implementation)
  // -------------------------------------------------------------------------

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || creatingInvite || !inviteEmail.trim()) return;
    setCreatingInvite(true);
    setError(null);
    const protocolAssignments: ProtocolAssignment[] = Array.from(assignments.entries()).map(
      ([protocol_id, role]) => ({ protocol_id, role }),
    );
    const result = await createOrgInvite(
      org.id,
      inviteEmail.trim(),
      inviteRole,
      protocolAssignments,
    );
    setCreatingInvite(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const url = buildInviteUrl(result.data.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(result.data.token);
      setTimeout(() => setCopiedToken(null), 2500);
    } catch {
      /* ignore — user can copy from the listing below */
    }
    setInviteEmail('');
    setAssignments(new Map());
    refresh();
  };

  function toggleAssignment(protocolId: string) {
    setAssignments((prev) => {
      const next = new Map(prev);
      if (next.has(protocolId)) next.delete(protocolId);
      else next.set(protocolId, 'member');
      return next;
    });
  }

  function setAssignmentRole(protocolId: string, role: ProtocolMemberRole) {
    setAssignments((prev) => {
      const next = new Map(prev);
      if (next.has(protocolId)) next.set(protocolId, role);
      return next;
    });
  }

  const handleRoleChange = async (member: OrgMemberWithProfile, role: OrgRole) => {
    if (!org) return;
    const result = await updateOrgMemberRole(org.id, member.user_id, role);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
  };

  const handleRemove = async (member: OrgMemberWithProfile) => {
    if (!org) return;
    const confirmed = window.confirm(`Remove ${member.name} from ${org.name}?`);
    if (!confirmed) return;
    const result = await removeOrgMember(org.id, member.user_id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
  };

  const copyInviteUrl = async (token: string) => {
    try {
      await navigator.clipboard.writeText(buildInviteUrl(token));
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2500);
    } catch {
      /* ignore */
    }
  };

  const handleRevokeInvite = async (invite: OrgInvite) => {
    if (!window.confirm(`Cancel the pending invite to ${invite.email}?`)) return;
    const result = await revokeOrgInvite(invite.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
  };

  // -------------------------------------------------------------------------
  // Bulk matrix handlers
  // -------------------------------------------------------------------------

  function effectiveRole(userId: string, protocolId: string): ProtocolMemberRole | null {
    const key = cellKey(userId, protocolId);
    if (pendingMatrix.has(key)) {
      // pendingMatrix value is the desired state — null means "remove",
      // a role means "add at this role".
      return pendingMatrix.get(key) ?? null;
    }
    return currentMatrix.get(key) ?? null;
  }

  function isPending(userId: string, protocolId: string): boolean {
    const key = cellKey(userId, protocolId);
    if (!pendingMatrix.has(key)) return false;
    const desired = pendingMatrix.get(key) ?? null;
    const actual = currentMatrix.get(key) ?? null;
    return desired !== actual;
  }

  function toggleCell(userId: string, protocolId: string) {
    const key = cellKey(userId, protocolId);
    const current = currentMatrix.get(key);
    setPendingMatrix((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        // Revert pending change.
        next.delete(key);
        return next;
      }
      if (current) {
        // Currently a member → mark for removal.
        next.set(key, null);
      } else {
        // Not a member → mark for add at the default bulk role.
        next.set(key, defaultBulkRole);
      }
      return next;
    });
  }

  const deltas = useMemo(() => {
    const adds: { userId: string; protocolId: string; role: ProtocolMemberRole }[] = [];
    const removes: { userId: string; protocolId: string }[] = [];
    for (const [key, desired] of pendingMatrix.entries()) {
      const [userId, protocolId] = key.split('|');
      const actual = currentMatrix.get(key) ?? null;
      if (desired === actual) continue;
      if (desired === null) removes.push({ userId, protocolId });
      else adds.push({ userId, protocolId, role: desired });
    }
    return { adds, removes };
  }, [pendingMatrix, currentMatrix]);

  const totalDeltas = deltas.adds.length + deltas.removes.length;

  async function applyChanges() {
    if (totalDeltas === 0 || applying) return;
    setApplying(true);
    setApplyError(null);
    const ops: Promise<{ ok: boolean }>[] = [
      ...deltas.adds.map((d) =>
        addProtocolMember({
          protocol_id: d.protocolId,
          user_id: d.userId,
          role: d.role,
        }),
      ),
      ...deltas.removes.map((d) => removeProtocolMember(d.protocolId, d.userId)),
    ];
    const results = await Promise.all(ops);
    const failures = results.filter((r) => !r.ok).length;
    if (failures > 0) {
      setApplyError(`${failures} of ${results.length} operations failed. The matrix has been refreshed — re-apply any rows that didn't go through.`);
    }
    setApplying(false);
    refresh();
  }

  function cancelChanges() {
    setPendingMatrix(new Map());
    setApplyError(null);
  }

  // -------------------------------------------------------------------------
  // Styling tokens
  // -------------------------------------------------------------------------

  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';
  const headingColor = 'text-fg-heading';
  const labelColor = 'text-fg-label';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionBg = isLight ? 'bg-[#F8FAFC]' : 'bg-white/[0.02]';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-brand-600/50'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-brand-300/50';
  const buttonGhost = isLight
    ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.05]'
    : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.05]';
  const matrixBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const stickyHeaderBg = isLight ? 'bg-[#F8FAFC]' : 'bg-[#0F172A]';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (demoActive) {
    return (
      <div className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs ${isLight ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-amber-500/[0.06] border border-amber-500/20 text-amber-300'}`}>
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <p>Demo mode — org administration actions are disabled.</p>
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
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs ${isLight ? 'bg-[#F8FAFC] border border-[#E2E8F0]' : 'bg-white/[0.02] border border-white/5'}`}>
        <AlertTriangle size={14} className={`mt-0.5 flex-shrink-0 ${mutedColor}`} />
        <p className={subColor}>Only site administrators can manage organization members.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className={`px-4 py-3 rounded-md text-xs ${isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'}`}>
          {error}
        </div>
      )}

      {/* ===== Invite to organization ===== */}
      <section className={`p-5 rounded-md ${sectionBg} border ${border} max-w-3xl`}>
        <h3 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold mb-1 flex items-center gap-1.5`}>
          <UserPlus size={11} />
          Invite to organization
        </h3>
        <p className={`${subColor} text-xs mb-3 leading-relaxed`}>
          Adds this person to the org. Use the protocol checklist below if you also want to assign
          them to specific protocols at the same time.
        </p>
        <form onSubmit={handleCreateInvite} className="space-y-2">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="name@example.com"
              className={`px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
              disabled={creatingInvite}
              required
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as OrgRole)}
              className={`px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
              disabled={creatingInvite}
            >
              <option value="member">Site member</option>
              <option value="admin">Site administrator</option>
            </select>
          </div>

          {orgProtocols.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
                Add to protocols
              </p>
              {orgProtocols.map((p) => {
                const checked = assignments.has(p.id);
                const role = assignments.get(p.id) ?? 'member';
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${border} cursor-pointer ${
                      checked ? (isLight ? 'bg-brand-600/[0.04]' : 'bg-brand-600/[0.08]') : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAssignment(p.id)}
                      className="flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`${headingColor} text-xs font-medium truncate`}>{p.code}</p>
                      <p className={`${mutedColor} text-[10px] truncate`}>{p.name}</p>
                    </div>
                    {checked && (
                      <select
                        value={role}
                        onChange={(e) =>
                          setAssignmentRole(p.id, e.target.value as ProtocolMemberRole)
                        }
                        onClick={(e) => e.stopPropagation()}
                        className={`text-[11px] rounded border px-1.5 py-0.5 ${inputBg} ${headingColor}`}
                      >
                        <option value="coordinator">Coordinator</option>
                        <option value="member">Team member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    )}
                  </label>
                );
              })}
              <p className={`${mutedColor} text-[10px] mt-1`}>
                Site administrators get implicit access to all org protocols, so this list is
                ignored when the role above is set to "Site administrator."
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={creatingInvite || !inviteEmail.trim()}
            className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
          >
            {creatingInvite ? 'Creating…' : 'Create invite + copy link'}
          </button>
        </form>

        {invites.length > 0 && (
          <div className="mt-4">
            <p className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold mb-2`}>
              Pending invites ({invites.length})
            </p>
            <ul className="space-y-1.5">
              {invites.map((inv) => (
                <li key={inv.id} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border ${border}`}>
                  <div className="min-w-0">
                    <p className={`${headingColor} text-sm truncate`}>{inv.email}</p>
                    <p className={`${mutedColor} text-[11px]`}>
                      {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => copyInviteUrl(inv.token)}
                      className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded ${isLight ? 'text-brand-600 hover:bg-brand-600/[0.06]' : 'text-brand-300 hover:bg-white/[0.04]'}`}
                    >
                      {copiedToken === inv.token ? <Check size={11} /> : <Copy size={11} />}
                      {copiedToken === inv.token ? 'Copied' : 'Copy link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevokeInvite(inv)}
                      className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded ${isLight ? 'text-red-600 hover:bg-red-500/[0.06]' : 'text-red-400 hover:bg-red-500/[0.08]'}`}
                      aria-label={`Cancel invite to ${inv.email}`}
                    >
                      <XCircle size={11} />
                      Cancel
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ===== Manage members ===== */}
      <section className="max-w-3xl">
        <h3 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold mb-1`}>
          Manage members ({members.length})
        </h3>
        <p className={`${subColor} text-xs mb-3 leading-relaxed`}>
          Change a member's organization role or remove them from the org. Protocol-level access
          is managed in the matrix below.
        </p>
        <ul className="space-y-1.5">
          {members.map((m) => (
            <li key={m.user_id} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border ${border}`}>
              <div className="min-w-0 flex items-center gap-2">
                {m.role === 'admin' ? (
                  <Crown size={13} className={isLight ? 'text-amber-600' : 'text-amber-400'} />
                ) : (
                  <UserIcon size={13} className={mutedColor} />
                )}
                <span className={`${headingColor} text-sm font-medium truncate`}>{m.name}</span>
                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${m.role === 'admin' ? (isLight ? 'bg-amber-100 text-amber-800' : 'bg-amber-500/15 text-amber-300') : (isLight ? 'bg-[#F2F2F2] text-[#334155]/65' : 'bg-white/[0.06] text-[#CBD5E1]/55')}`}>
                  {m.role === 'admin' ? 'Site administrator' : 'Site member'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {m.role === 'admin' ? (
                  <button
                    type="button"
                    onClick={() => handleRoleChange(m, 'member')}
                    className={`text-[11px] px-2 py-1 rounded ${buttonGhost}`}
                  >
                    Make site member
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleRoleChange(m, 'admin')}
                    className={`text-[11px] px-2 py-1 rounded ${buttonGhost}`}
                  >
                    Make site administrator
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(m)}
                  className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded ${isLight ? 'text-red-600 hover:bg-red-500/[0.06]' : 'text-red-400 hover:bg-red-500/[0.08]'}`}
                  aria-label={`Remove ${m.name}`}
                >
                  <Trash2 size={11} />
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ===== Bulk protocol access matrix ===== */}
      <section>
        <h3 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold mb-1 flex items-center gap-1.5`}>
          <Grid3x3 size={11} />
          Bulk protocol access
        </h3>
        <p className={`${subColor} text-xs mb-3 leading-relaxed max-w-2xl`}>
          Toggle cells to add or remove protocol access in bulk. New assignments are created at
          the default role below; change individual roles afterward from the Team tab.
        </p>

        {orgProtocols.length === 0 || members.length === 0 ? (
          <div className={`px-4 py-6 rounded-md border ${border} text-center`}>
            <p className={`${subColor} text-xs`}>
              {orgProtocols.length === 0
                ? 'No protocols in this organization yet.'
                : 'No members in this organization yet.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-3">
              <label className={`${labelColor} text-[11px] uppercase tracking-wider font-semibold`}>
                Default role for new assignments
              </label>
              <select
                value={defaultBulkRole}
                onChange={(e) => setDefaultBulkRole(e.target.value as ProtocolMemberRole)}
                className={`text-xs rounded border px-2 py-1 ${inputBg} ${headingColor}`}
              >
                <option value="member">Team member</option>
                <option value="coordinator">Coordinator</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>

            <div className={`border ${border} rounded-md overflow-auto ${matrixBg}`}>
              <table className="text-xs w-max">
                <thead>
                  <tr>
                    <th
                      className={`sticky left-0 top-0 z-20 ${stickyHeaderBg} px-3 py-2 text-left ${labelColor} uppercase tracking-wider font-semibold border-b border-r ${border}`}
                    >
                      Member
                    </th>
                    {orgProtocols.map((p) => (
                      <th
                        key={p.id}
                        className={`sticky top-0 z-10 ${stickyHeaderBg} px-3 py-2 text-left border-b ${border} min-w-[140px]`}
                      >
                        <p className={`${headingColor} font-semibold`}>{p.code}</p>
                        <p className={`${mutedColor} text-[10px] truncate`}>{p.name}</p>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.user_id}>
                      <th
                        scope="row"
                        className={`sticky left-0 z-10 ${stickyHeaderBg} px-3 py-2 text-left border-b border-r ${border} min-w-[200px]`}
                      >
                        <p className={`${headingColor} font-medium truncate flex items-center gap-1.5`}>
                          {m.role === 'admin' ? (
                            <Crown size={11} className={isLight ? 'text-amber-600' : 'text-amber-400'} />
                          ) : (
                            <UserIcon size={11} className={mutedColor} />
                          )}
                          {m.name}
                        </p>
                      </th>
                      {orgProtocols.map((p) => {
                        const role = effectiveRole(m.user_id, p.id);
                        const pending = isPending(m.user_id, p.id);
                        // Admins have implicit access — surface that visually without
                        // letting the user create a redundant protocol_members row.
                        const adminImplicit = m.role === 'admin';
                        return (
                          <td
                            key={p.id}
                            className={`px-2 py-1.5 border-b ${border} align-middle`}
                          >
                            <button
                              type="button"
                              disabled={adminImplicit}
                              onClick={() => toggleCell(m.user_id, p.id)}
                              className={`w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                                adminImplicit
                                  ? (isLight ? 'bg-amber-100 text-amber-800 cursor-not-allowed' : 'bg-amber-500/15 text-amber-300 cursor-not-allowed')
                                  : role
                                    ? pending
                                      ? (isLight ? 'bg-rose-100 text-rose-700 line-through' : 'bg-rose-500/15 text-rose-300 line-through')
                                      : (isLight ? 'bg-brand-600/10 text-brand-600' : 'bg-brand-600/20 text-brand-300')
                                    : pending
                                      ? (isLight ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-500/15 text-emerald-300')
                                      : (isLight ? 'text-[#334155]/40 hover:bg-[#0F172A]/[0.04]' : 'text-[#CBD5E1]/40 hover:bg-white/[0.05]')
                              }`}
                              aria-label={`${m.name} on ${p.code}: ${role ? ROLE_LABEL[role] : 'not a member'}${pending ? ' (pending)' : ''}`}
                            >
                              {adminImplicit ? 'Admin (implicit)' : role ? ROLE_LABEL[role] : '—'}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {applyError && (
              <div className={`mt-3 px-3 py-2 rounded-md text-xs ${isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'}`}>
                {applyError}
              </div>
            )}

            <div className="mt-3 flex items-center gap-3">
              <p className={`${subColor} text-xs`}>
                {totalDeltas === 0
                  ? 'No pending changes'
                  : `${deltas.adds.length} addition${deltas.adds.length === 1 ? '' : 's'}, ${deltas.removes.length} removal${deltas.removes.length === 1 ? '' : 's'}`}
              </p>
              <div className="flex-1" />
              <button
                type="button"
                onClick={cancelChanges}
                disabled={totalDeltas === 0 || applying}
                className={`text-xs px-3 py-1.5 rounded-md ${buttonGhost} disabled:opacity-40`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyChanges}
                disabled={totalDeltas === 0 || applying}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
              >
                {applying && <Loader2 size={12} className="animate-spin" />}
                {applying ? 'Applying…' : 'Apply changes'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
