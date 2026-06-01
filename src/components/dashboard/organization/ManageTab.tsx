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
  Layers,
  Loader2,
  ArrowRight,
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

  // Bulk protocol access — two-list checker.
  // currentAssignments[cellKey] = role on the server (absent if not a member).
  // Used to skip already-assigned pairs on submit.
  const [currentAssignments, setCurrentAssignments] = useState<Map<string, ProtocolMemberRole>>(
    new Map(),
  );
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [selectedProtocolIds, setSelectedProtocolIds] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<ProtocolMemberRole>('member');
  const [applying, setApplying] = useState(false);
  const [bulkResult, setBulkResult] = useState<
    | {
        added: { memberName: string; protocolCode: string }[];
        skipped: { memberName: string; protocolCode: string; reason: string }[];
        failed: { memberName: string; protocolCode: string; reason: string }[];
      }
    | null
  >(null);

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

      // Build current-assignment lookup by fetching protocol_members for each
      // org protocol in parallel. Used to skip already-assigned pairs on
      // submit (and to surface "already assigned" in the results banner).
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
      setCurrentAssignments(next);
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
  // Bulk protocol access — two-list checker handlers
  // -------------------------------------------------------------------------

  // Site admins have implicit access to every org protocol, so creating
  // protocol_members rows for them is meaningless. Exclude them from the
  // selectable member list (separate from the read-only roster which still
  // shows them).
  const assignableMembers = useMemo(
    () => members.filter((m) => m.role !== 'admin'),
    [members],
  );

  function toggleMember(userId: string) {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function toggleProtocol(protocolId: string) {
    setSelectedProtocolIds((prev) => {
      const next = new Set(prev);
      if (next.has(protocolId)) next.delete(protocolId);
      else next.add(protocolId);
      return next;
    });
  }

  function selectAllMembers() {
    setSelectedMemberIds(new Set(assignableMembers.map((m) => m.user_id)));
  }

  function clearMemberSelection() {
    setSelectedMemberIds(new Set());
  }

  function selectAllProtocols() {
    setSelectedProtocolIds(new Set(orgProtocols.map((p) => p.id)));
  }

  function clearProtocolSelection() {
    setSelectedProtocolIds(new Set());
  }

  const plannedPairs = useMemo(() => {
    // Cartesian product of selected members × selected protocols, split into
    // "needs insert" (not yet assigned) and "skipped" (already assigned).
    const newPairs: { userId: string; protocolId: string }[] = [];
    const skippedPairs: { userId: string; protocolId: string }[] = [];
    for (const userId of selectedMemberIds) {
      for (const protocolId of selectedProtocolIds) {
        const key = cellKey(userId, protocolId);
        if (currentAssignments.has(key)) skippedPairs.push({ userId, protocolId });
        else newPairs.push({ userId, protocolId });
      }
    }
    return { newPairs, skippedPairs };
  }, [selectedMemberIds, selectedProtocolIds, currentAssignments]);

  async function applyAssignments() {
    const { newPairs, skippedPairs } = plannedPairs;
    if (newPairs.length === 0 && skippedPairs.length === 0) return;
    if (applying) return;

    const nameOf = (userId: string) =>
      members.find((m) => m.user_id === userId)?.name ?? 'Unknown';
    const codeOf = (protocolId: string) =>
      orgProtocols.find((p) => p.id === protocolId)?.code ?? 'Unknown';

    setApplying(true);
    setBulkResult(null);

    const results = await Promise.all(
      newPairs.map(async (pair) => {
        const res = await addProtocolMember({
          protocol_id: pair.protocolId,
          user_id: pair.userId,
          role: bulkRole,
        });
        return { pair, res };
      }),
    );

    const added: { memberName: string; protocolCode: string }[] = [];
    const failed: { memberName: string; protocolCode: string; reason: string }[] = [];
    for (const { pair, res } of results) {
      if (res.ok) {
        added.push({ memberName: nameOf(pair.userId), protocolCode: codeOf(pair.protocolId) });
      } else {
        failed.push({
          memberName: nameOf(pair.userId),
          protocolCode: codeOf(pair.protocolId),
          reason: res.error,
        });
      }
    }
    const skipped = skippedPairs.map((pair) => ({
      memberName: nameOf(pair.userId),
      protocolCode: codeOf(pair.protocolId),
      reason: 'Already assigned',
    }));

    setBulkResult({ added, skipped, failed });
    setApplying(false);
    setSelectedMemberIds(new Set());
    setSelectedProtocolIds(new Set());
    refresh();
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
  const listBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const linkButton = isLight
    ? 'text-brand-600 hover:underline'
    : 'text-brand-300 hover:underline';

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

      {/* ===== Bulk protocol access — two-list checker ===== */}
      <section>
        <h3 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold mb-1 flex items-center gap-1.5`}>
          <Layers size={11} />
          Bulk protocol access
        </h3>
        <p className={`${subColor} text-xs mb-4 leading-relaxed max-w-2xl`}>
          Check the members on the left and the protocols on the right, then click Add. Each
          selected member gets added to each selected protocol at the chosen role.
          Already-assigned pairs are skipped automatically. Site administrators are excluded —
          they already have access to every protocol.
        </p>

        {orgProtocols.length === 0 || assignableMembers.length === 0 ? (
          <div className={`px-4 py-6 rounded-md border ${border} text-center`}>
            <p className={`${subColor} text-xs`}>
              {orgProtocols.length === 0
                ? 'No protocols in this organization yet.'
                : 'No assignable members in this organization yet (site administrators have implicit access).'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Members column */}
              <div className={`border ${border} rounded-md ${listBg} flex flex-col`}>
                <div className={`flex items-center justify-between px-3 py-2 border-b ${border}`}>
                  <h4 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
                    Members ({selectedMemberIds.size}/{assignableMembers.length})
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllMembers}
                      className={`${linkButton} text-[11px]`}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={clearMemberSelection}
                      className={`${linkButton} text-[11px]`}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <ul className="max-h-72 overflow-y-auto py-1">
                  {assignableMembers.map((m) => {
                    const checked = selectedMemberIds.has(m.user_id);
                    return (
                      <li key={m.user_id}>
                        <label
                          className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer ${
                            isLight
                              ? checked
                                ? 'bg-brand-600/[0.05]'
                                : 'hover:bg-[#0F172A]/[0.03]'
                              : checked
                                ? 'bg-brand-600/[0.10]'
                                : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMember(m.user_id)}
                            className="flex-shrink-0"
                          />
                          <UserIcon size={12} className={mutedColor} />
                          <span className={`${headingColor} text-sm font-medium truncate`}>
                            {m.name}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Protocols column */}
              <div className={`border ${border} rounded-md ${listBg} flex flex-col`}>
                <div className={`flex items-center justify-between px-3 py-2 border-b ${border}`}>
                  <h4 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
                    Protocols ({selectedProtocolIds.size}/{orgProtocols.length})
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllProtocols}
                      className={`${linkButton} text-[11px]`}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={clearProtocolSelection}
                      className={`${linkButton} text-[11px]`}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <ul className="max-h-72 overflow-y-auto py-1">
                  {orgProtocols.map((p) => {
                    const checked = selectedProtocolIds.has(p.id);
                    return (
                      <li key={p.id}>
                        <label
                          className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer ${
                            isLight
                              ? checked
                                ? 'bg-brand-600/[0.05]'
                                : 'hover:bg-[#0F172A]/[0.03]'
                              : checked
                                ? 'bg-brand-600/[0.10]'
                                : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProtocol(p.id)}
                            className="flex-shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className={`${headingColor} text-sm font-medium truncate`}>
                              {p.code}
                            </p>
                            <p className={`${mutedColor} text-[10px] truncate`}>{p.name}</p>
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* Action bar */}
            <div className={`flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-md border ${border} ${sectionBg}`}>
              <label className={`${labelColor} text-[11px] uppercase tracking-wider font-semibold`}>
                Role
              </label>
              <select
                value={bulkRole}
                onChange={(e) => setBulkRole(e.target.value as ProtocolMemberRole)}
                className={`text-xs rounded border px-2 py-1 ${inputBg} ${headingColor}`}
              >
                <option value="member">Team member</option>
                <option value="coordinator">Coordinator</option>
                <option value="viewer">Viewer</option>
              </select>
              <p className={`${subColor} text-xs`}>
                {selectedMemberIds.size === 0 || selectedProtocolIds.size === 0
                  ? 'Select members and protocols to add'
                  : `${plannedPairs.newPairs.length} new assignment${plannedPairs.newPairs.length === 1 ? '' : 's'}${
                      plannedPairs.skippedPairs.length > 0
                        ? `, ${plannedPairs.skippedPairs.length} already assigned`
                        : ''
                    }`}
              </p>
              <div className="flex-1" />
              <button
                type="button"
                onClick={applyAssignments}
                disabled={
                  applying ||
                  selectedMemberIds.size === 0 ||
                  selectedProtocolIds.size === 0 ||
                  plannedPairs.newPairs.length === 0
                }
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
              >
                {applying ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
                {applying ? 'Adding…' : 'Add to selected protocols'}
              </button>
            </div>

            {/* Result banner */}
            {bulkResult && (
              <div className={`px-4 py-3 rounded-md border space-y-2 ${
                bulkResult.failed.length > 0
                  ? isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-500/[0.06] border-amber-500/30'
                  : isLight ? 'bg-emerald-50 border-emerald-200' : 'bg-emerald-500/[0.06] border-emerald-500/30'
              }`}>
                {bulkResult.added.length > 0 && (
                  <div className="flex items-start gap-2">
                    <Check size={13} className={`${isLight ? 'text-emerald-700' : 'text-emerald-400'} mt-0.5 flex-shrink-0`} />
                    <p className={`text-xs ${isLight ? 'text-emerald-800' : 'text-emerald-300'} leading-relaxed`}>
                      Added {bulkResult.added.length} assignment{bulkResult.added.length === 1 ? '' : 's'} at role <strong>{ROLE_LABEL[bulkRole]}</strong>:
                      {' '}
                      {bulkResult.added.map((a, i) => (
                        <span key={i}>
                          {i > 0 && ', '}
                          {a.memberName} → {a.protocolCode}
                        </span>
                      ))}
                    </p>
                  </div>
                )}
                {bulkResult.skipped.length > 0 && (
                  <p className={`text-xs ${subColor} pl-5`}>
                    Skipped (already assigned): {bulkResult.skipped.map((s) => `${s.memberName} → ${s.protocolCode}`).join(', ')}
                  </p>
                )}
                {bulkResult.failed.length > 0 && (
                  <p className={`text-xs ${isLight ? 'text-rose-700' : 'text-rose-300'} pl-5`}>
                    Failed: {bulkResult.failed.map((f) => `${f.memberName} → ${f.protocolCode} (${f.reason})`).join('; ')}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setBulkResult(null)}
                  className={`${linkButton} text-[11px] pl-5`}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
