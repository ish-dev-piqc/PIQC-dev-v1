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
  HardDrive,
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
  updateProtocolMemberRole,
} from '../../../lib/orgs/orgsApi';
import {
  countOrphanChatAttachments,
  deleteOrphanChatAttachments,
} from '../../../lib/orgs/chatAttachmentsCleanupApi';
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

  // Storage maintenance — orphan chat-attachment sweep. Two-step flow:
  // null  → not yet checked
  // n>=0  → preview count; "Delete" button visible
  // 'deleting' / 'deleted:n' / error string covers the rest.
  type OrphanState =
    | { kind: 'idle' }
    | { kind: 'counting' }
    | { kind: 'previewed'; count: number }
    | { kind: 'deleting'; count: number }
    | { kind: 'done'; deleted: number }
    | { kind: 'error'; message: string };
  const [orphanState, setOrphanState] = useState<OrphanState>({ kind: 'idle' });

  const handleFindOrphans = useCallback(async () => {
    setOrphanState({ kind: 'counting' });
    const res = await countOrphanChatAttachments();
    if (!res.ok) {
      setOrphanState({ kind: 'error', message: res.error });
      return;
    }
    setOrphanState({ kind: 'previewed', count: res.data });
  }, []);

  const handleDeleteOrphans = useCallback(async () => {
    if (orphanState.kind !== 'previewed') return;
    setOrphanState({ kind: 'deleting', count: orphanState.count });
    const res = await deleteOrphanChatAttachments();
    if (!res.ok) {
      setOrphanState({ kind: 'error', message: res.error });
      return;
    }
    setOrphanState({ kind: 'done', deleted: res.data });
  }, [orphanState]);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  // After invite creation, briefly show "✓ Email sent to <email>" or a
  // warning if the Edge Function failed. Cleared on next form submit.
  const [lastInviteResult, setLastInviteResult] = useState<
    { email: string; emailSent: boolean } | null
  >(null);
  const [orgProtocols, setOrgProtocols] = useState<OrgProtocolSummary[]>([]);
  const [assignments, setAssignments] = useState<Map<string, ProtocolMemberRole>>(new Map());

  // Bulk protocol access — paired two-list selection.
  // currentAssignments[cellKey] = role on the server (absent if not a member).
  // Used to skip already-assigned pairs on submit.
  const [currentAssignments, setCurrentAssignments] = useState<Map<string, ProtocolMemberRole>>(
    new Map(),
  );
  // selectedMembers maps userId → role to assign for THIS user. Each member
  // can be added at a different role in the same batch (Maya as Coordinator,
  // Sam as Team member). Default role on selection is 'member'.
  const [selectedMembers, setSelectedMembers] = useState<Map<string, ProtocolMemberRole>>(
    new Map(),
  );
  const [selectedProtocolIds, setSelectedProtocolIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [bulkResult, setBulkResult] = useState<
    | {
        added: { memberName: string; protocolCode: string; role: ProtocolMemberRole }[];
        roleChanged: {
          memberName: string;
          protocolCode: string;
          from: ProtocolMemberRole;
          to: ProtocolMemberRole;
        }[];
        skipped: { memberName: string; protocolCode: string; reason: string }[];
        failed: { memberName: string; protocolCode: string; reason: string }[];
      }
    | null
  >(null);

  // Conflict modal: shown when the bulk submission includes (member, protocol)
  // pairs that already exist at a different role. The user resolves each one
  // with Skip vs Change role, then we apply the new pairs + the requested
  // role updates. Same-role conflicts (existing == requested) bypass the
  // modal entirely — there's nothing to decide.
  const [conflictModal, setConflictModal] = useState<{
    differentRole: {
      userId: string;
      protocolId: string;
      currentRole: ProtocolMemberRole;
      requestedRole: ProtocolMemberRole;
    }[];
    sameRoleCount: number;
    resolutions: Map<string, 'skip' | 'change'>;
  } | null>(null);

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
    const submittedEmail = inviteEmail.trim();
    setCreatingInvite(true);
    setError(null);
    setLastInviteResult(null);
    const protocolAssignments: ProtocolAssignment[] = Array.from(assignments.entries()).map(
      ([protocol_id, role]) => ({ protocol_id, role }),
    );
    const result = await createOrgInvite(
      org.id,
      submittedEmail,
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
    setLastInviteResult({ email: submittedEmail, emailSent: result.data.emailSent });
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
    setSelectedMembers((prev) => {
      const next = new Map(prev);
      if (next.has(userId)) next.delete(userId);
      else next.set(userId, 'member'); // default role on first select
      return next;
    });
  }

  function setMemberRole(userId: string, role: ProtocolMemberRole) {
    setSelectedMembers((prev) => {
      const next = new Map(prev);
      if (next.has(userId)) next.set(userId, role);
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
    setSelectedMembers(new Map(assignableMembers.map((m) => [m.user_id, 'member' as ProtocolMemberRole])));
  }

  function clearMemberSelection() {
    setSelectedMembers(new Map());
  }

  function selectAllProtocols() {
    setSelectedProtocolIds(new Set(orgProtocols.map((p) => p.id)));
  }

  function clearProtocolSelection() {
    setSelectedProtocolIds(new Set());
  }

  const plannedPairs = useMemo(() => {
    // Cartesian product of selected members × selected protocols, split into:
    //   - newPairs: no existing assignment → straight add
    //   - sameRoleConflicts: already assigned at the requested role → auto-skip
    //   - differentRoleConflicts: already assigned at a DIFFERENT role →
    //     requires a Skip / Change decision in the conflict modal.
    const newPairs: { userId: string; protocolId: string; role: ProtocolMemberRole }[] = [];
    const sameRoleConflicts: {
      userId: string;
      protocolId: string;
      currentRole: ProtocolMemberRole;
      requestedRole: ProtocolMemberRole;
    }[] = [];
    const differentRoleConflicts: {
      userId: string;
      protocolId: string;
      currentRole: ProtocolMemberRole;
      requestedRole: ProtocolMemberRole;
    }[] = [];
    for (const [userId, role] of selectedMembers) {
      for (const protocolId of selectedProtocolIds) {
        const key = cellKey(userId, protocolId);
        const existing = currentAssignments.get(key);
        if (existing === undefined) {
          newPairs.push({ userId, protocolId, role });
        } else if (existing === role) {
          sameRoleConflicts.push({
            userId,
            protocolId,
            currentRole: existing,
            requestedRole: role,
          });
        } else {
          differentRoleConflicts.push({
            userId,
            protocolId,
            currentRole: existing,
            requestedRole: role,
          });
        }
      }
    }
    return { newPairs, sameRoleConflicts, differentRoleConflicts };
  }, [selectedMembers, selectedProtocolIds, currentAssignments]);

  function nameOf(userId: string): string {
    return members.find((m) => m.user_id === userId)?.name ?? 'Unknown';
  }
  function codeOf(protocolId: string): string {
    return orgProtocols.find((p) => p.id === protocolId)?.code ?? 'Unknown';
  }

  // Click handler on the main "Add to selected protocols" button. Routes to
  // either the immediate-commit path or the conflict modal depending on
  // whether any pairs need a Skip/Change decision.
  function handleApplyClick() {
    const { newPairs, sameRoleConflicts, differentRoleConflicts } = plannedPairs;
    if (newPairs.length === 0 && differentRoleConflicts.length === 0) return;
    if (applying) return;
    if (differentRoleConflicts.length > 0) {
      // Open the modal — default every conflict to 'skip' so a user who just
      // clicks Apply doesn't accidentally clobber existing roles.
      const resolutions = new Map<string, 'skip' | 'change'>();
      for (const c of differentRoleConflicts) {
        resolutions.set(cellKey(c.userId, c.protocolId), 'skip');
      }
      setConflictModal({
        differentRole: differentRoleConflicts,
        sameRoleCount: sameRoleConflicts.length,
        resolutions,
      });
      return;
    }
    // No conflicts requiring user input — commit the new pairs directly.
    void commitAssignments(newPairs, [], sameRoleConflicts.length);
  }

  function setResolution(key: string, value: 'skip' | 'change') {
    setConflictModal((prev) => {
      if (!prev) return prev;
      const next = new Map(prev.resolutions);
      next.set(key, value);
      return { ...prev, resolutions: next };
    });
  }

  async function confirmConflictModal() {
    if (!conflictModal) return;
    const { differentRole, sameRoleCount, resolutions } = conflictModal;
    const { newPairs } = plannedPairs;
    const roleChanges = differentRole.filter(
      (c) => resolutions.get(cellKey(c.userId, c.protocolId)) === 'change',
    );
    setConflictModal(null);
    await commitAssignments(newPairs, roleChanges, sameRoleCount);
  }

  async function commitAssignments(
    newPairs: { userId: string; protocolId: string; role: ProtocolMemberRole }[],
    roleChanges: {
      userId: string;
      protocolId: string;
      currentRole: ProtocolMemberRole;
      requestedRole: ProtocolMemberRole;
    }[],
    sameRoleSkipCount: number,
  ) {
    setApplying(true);
    setBulkResult(null);

    // Run inserts and role-changes in parallel — the server treats them as
    // independent rows / updates.
    const addResults = await Promise.all(
      newPairs.map(async (pair) => {
        const res = await addProtocolMember({
          protocol_id: pair.protocolId,
          user_id: pair.userId,
          role: pair.role,
        });
        return { pair, res };
      }),
    );
    const changeResults = await Promise.all(
      roleChanges.map(async (change) => {
        const res = await updateProtocolMemberRole(change.protocolId, change.userId, {
          role: change.requestedRole,
        });
        return { change, res };
      }),
    );

    const added: { memberName: string; protocolCode: string; role: ProtocolMemberRole }[] = [];
    const roleChanged: {
      memberName: string;
      protocolCode: string;
      from: ProtocolMemberRole;
      to: ProtocolMemberRole;
    }[] = [];
    const failed: { memberName: string; protocolCode: string; reason: string }[] = [];

    for (const { pair, res } of addResults) {
      if (res.ok) {
        added.push({
          memberName: nameOf(pair.userId),
          protocolCode: codeOf(pair.protocolId),
          role: pair.role,
        });
      } else {
        failed.push({
          memberName: nameOf(pair.userId),
          protocolCode: codeOf(pair.protocolId),
          reason: res.error,
        });
      }
    }
    for (const { change, res } of changeResults) {
      if (res.ok) {
        roleChanged.push({
          memberName: nameOf(change.userId),
          protocolCode: codeOf(change.protocolId),
          from: change.currentRole,
          to: change.requestedRole,
        });
      } else {
        failed.push({
          memberName: nameOf(change.userId),
          protocolCode: codeOf(change.protocolId),
          reason: res.error,
        });
      }
    }

    // Same-role + user-chose-skip pairs aren't surfaced individually — just
    // an aggregate count so the banner doesn't get noisy when many users are
    // selected against many protocols.
    const skipped: { memberName: string; protocolCode: string; reason: string }[] = [];
    if (sameRoleSkipCount > 0) {
      skipped.push({
        memberName: '',
        protocolCode: '',
        reason: `${sameRoleSkipCount} already at the requested role`,
      });
    }
    const skippedByUser = (conflictModal?.differentRole ?? []).filter(
      (c) => conflictModal?.resolutions.get(cellKey(c.userId, c.protocolId)) === 'skip',
    );
    for (const c of skippedByUser) {
      skipped.push({
        memberName: nameOf(c.userId),
        protocolCode: codeOf(c.protocolId),
        reason: `kept as ${ROLE_LABEL[c.currentRole]}`,
      });
    }

    setBulkResult({ added, roleChanged, skipped, failed });
    setApplying(false);
    setSelectedMembers(new Map());
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
            {creatingInvite ? 'Creating…' : 'Create invite + send email'}
          </button>

          {lastInviteResult && (
            lastInviteResult.emailSent ? (
              <div
                className={`mt-2 flex items-start gap-2 px-3 py-2 rounded-md text-xs ${
                  isLight
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-emerald-500/[0.06] border border-emerald-500/30 text-emerald-300'
                }`}
              >
                <Check size={13} className="mt-0.5 flex-shrink-0" />
                <span>
                  Invite sent to <strong>{lastInviteResult.email}</strong>. The link
                  is also on your clipboard.
                </span>
              </div>
            ) : (
              <div
                className={`mt-2 flex items-start gap-2 px-3 py-2 rounded-md text-xs ${
                  isLight
                    ? 'bg-amber-50 border border-amber-200 text-amber-800'
                    : 'bg-amber-500/[0.06] border border-amber-500/30 text-amber-300'
                }`}
              >
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                <span>
                  Invite created for <strong>{lastInviteResult.email}</strong>, but
                  the email couldn't be sent. The link is on your clipboard — share
                  it manually, or use the Copy link button below.
                </span>
              </div>
            )
          )}
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
          <>
            {/* Single grouped container — members + protocols + action bar
                read as one paired-selection workflow. */}
            <div className={`border ${border} rounded-md ${sectionBg}`}>
              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${border}`}>
                <p className={`${headingColor} text-xs font-semibold`}>Add members to protocols</p>
                <p className={`${subColor} text-[11px]`}>
                  Check who, check where, pick a role per person, click Add.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:gap-0">
                {/* Members column */}
                <div className={`border-b md:border-b-0 md:border-r ${border} ${listBg} flex flex-col`}>
                  <div className={`flex items-center justify-between px-3 py-2 border-b ${border}`}>
                    <h4 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
                      Members ({selectedMembers.size}/{assignableMembers.length})
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
                      const checked = selectedMembers.has(m.user_id);
                      const role = selectedMembers.get(m.user_id) ?? 'member';
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
                            <span className={`${headingColor} text-sm font-medium truncate flex-1 min-w-0`}>
                              {m.name}
                            </span>
                            {checked && (
                              <select
                                value={role}
                                onChange={(e) =>
                                  setMemberRole(m.user_id, e.target.value as ProtocolMemberRole)
                                }
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Role for ${m.name}`}
                                className={`text-[11px] rounded border px-1.5 py-0.5 ${inputBg} ${headingColor} flex-shrink-0`}
                              >
                                <option value="member">Team member</option>
                                <option value="coordinator">Coordinator</option>
                                <option value="viewer">Viewer</option>
                              </select>
                            )}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Protocols column */}
                <div className={`${listBg} flex flex-col`}>
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

              {/* Action bar — count + apply button inside the same container */}
              <div className={`flex flex-wrap items-center gap-3 px-4 py-2.5 border-t ${border}`}>
                <p className={`${subColor} text-xs`}>
                  {selectedMembers.size === 0 || selectedProtocolIds.size === 0
                    ? 'Select members and protocols to add'
                    : `${plannedPairs.newPairs.length} new${
                        plannedPairs.differentRoleConflicts.length > 0
                          ? `, ${plannedPairs.differentRoleConflicts.length} role conflict${plannedPairs.differentRoleConflicts.length === 1 ? '' : 's'}`
                          : ''
                      }${
                        plannedPairs.sameRoleConflicts.length > 0
                          ? `, ${plannedPairs.sameRoleConflicts.length} already at this role`
                          : ''
                      }`}
                </p>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={handleApplyClick}
                  disabled={
                    applying ||
                    selectedMembers.size === 0 ||
                    selectedProtocolIds.size === 0 ||
                    (plannedPairs.newPairs.length === 0 &&
                      plannedPairs.differentRoleConflicts.length === 0)
                  }
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
                >
                  {applying ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
                  {applying ? 'Adding…' : 'Add to selected protocols'}
                </button>
              </div>
            </div>

            {/* Result banner */}
            {bulkResult && (
              <div className={`mt-4 px-4 py-3 rounded-md border space-y-2 ${
                bulkResult.failed.length > 0
                  ? isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-500/[0.06] border-amber-500/30'
                  : isLight ? 'bg-emerald-50 border-emerald-200' : 'bg-emerald-500/[0.06] border-emerald-500/30'
              }`}>
                {bulkResult.added.length > 0 && (
                  <div className="flex items-start gap-2">
                    <Check size={13} className={`${isLight ? 'text-emerald-700' : 'text-emerald-400'} mt-0.5 flex-shrink-0`} />
                    <p className={`text-xs ${isLight ? 'text-emerald-800' : 'text-emerald-300'} leading-relaxed`}>
                      Added {bulkResult.added.length} assignment{bulkResult.added.length === 1 ? '' : 's'}:
                      {' '}
                      {bulkResult.added.map((a, i) => (
                        <span key={i}>
                          {i > 0 && ', '}
                          {a.memberName} → {a.protocolCode} ({ROLE_LABEL[a.role]})
                        </span>
                      ))}
                    </p>
                  </div>
                )}
                {bulkResult.roleChanged.length > 0 && (
                  <p className={`text-xs ${isLight ? 'text-emerald-800' : 'text-emerald-300'} pl-5 leading-relaxed`}>
                    Updated {bulkResult.roleChanged.length} role
                    {bulkResult.roleChanged.length === 1 ? '' : 's'}:
                    {' '}
                    {bulkResult.roleChanged.map((r, i) => (
                      <span key={i}>
                        {i > 0 && ', '}
                        {r.memberName} → {r.protocolCode} ({ROLE_LABEL[r.from]} → {ROLE_LABEL[r.to]})
                      </span>
                    ))}
                  </p>
                )}
                {bulkResult.skipped.length > 0 && (
                  <p className={`text-xs ${subColor} pl-5`}>
                    Skipped: {bulkResult.skipped
                      .map((s) =>
                        s.memberName === ''
                          ? s.reason
                          : `${s.memberName} → ${s.protocolCode} (${s.reason})`,
                      )
                      .join(', ')}
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

            {/* Conflict resolution modal — opens when a bulk submission
                includes pairs already assigned at a DIFFERENT role. */}
            {conflictModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
                <div
                  className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                  onClick={() => setConflictModal(null)}
                  aria-hidden="true"
                />
                <div className={`relative max-w-lg w-full max-h-[80vh] flex flex-col rounded-lg border shadow-xl ${isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10'}`}>
                  <div className={`px-5 py-3 border-b ${border} flex items-start gap-2`}>
                    <AlertTriangle size={16} className={isLight ? 'text-amber-600' : 'text-amber-400'} />
                    <div>
                      <h3 className={`${headingColor} text-sm font-semibold`}>
                        {conflictModal.differentRole.length} member
                        {conflictModal.differentRole.length === 1 ? ' is' : 's are'} already on a selected protocol
                      </h3>
                      <p className={`${subColor} text-xs mt-0.5 leading-relaxed`}>
                        Each one already has a different role than you picked. Skip to leave the
                        existing role, or change to the role you selected.
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
                    {conflictModal.differentRole.map((c) => {
                      const key = cellKey(c.userId, c.protocolId);
                      const choice = conflictModal.resolutions.get(key) ?? 'skip';
                      return (
                        <div key={key} className={`rounded-md border ${border} px-3 py-2.5`}>
                          <p className={`${headingColor} text-sm font-medium`}>
                            {nameOf(c.userId)} → {codeOf(c.protocolId)}
                          </p>
                          <p className={`${subColor} text-xs mt-0.5`}>
                            Currently <strong>{ROLE_LABEL[c.currentRole]}</strong>. You picked{' '}
                            <strong>{ROLE_LABEL[c.requestedRole]}</strong>.
                          </p>
                          <div className="mt-2 flex flex-col gap-1.5">
                            <label className={`inline-flex items-center gap-2 text-xs ${headingColor} cursor-pointer`}>
                              <input
                                type="radio"
                                name={`conflict-${key}`}
                                checked={choice === 'skip'}
                                onChange={() => setResolution(key, 'skip')}
                              />
                              Skip — keep as {ROLE_LABEL[c.currentRole]}
                            </label>
                            <label className={`inline-flex items-center gap-2 text-xs ${headingColor} cursor-pointer`}>
                              <input
                                type="radio"
                                name={`conflict-${key}`}
                                checked={choice === 'change'}
                                onChange={() => setResolution(key, 'change')}
                              />
                              Change to {ROLE_LABEL[c.requestedRole]}
                            </label>
                          </div>
                        </div>
                      );
                    })}
                    {conflictModal.sameRoleCount > 0 && (
                      <p className={`${subColor} text-[11px] italic`}>
                        ({conflictModal.sameRoleCount} other pair
                        {conflictModal.sameRoleCount === 1 ? ' is' : 's are'} already at the
                        requested role — those are skipped automatically.)
                      </p>
                    )}
                  </div>

                  <div className={`flex items-center justify-end gap-2 px-5 py-3 border-t ${border}`}>
                    <button
                      type="button"
                      onClick={() => setConflictModal(null)}
                      className={`text-xs px-3 py-1.5 rounded-md ${buttonGhost}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmConflictModal}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
                    >
                      <Check size={12} />
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* -------------------------------------------------------------------
          Storage maintenance — orphan chat-attachment sweep.
          Two-click: "Find orphans" → "Delete N files".
      ------------------------------------------------------------------- */}
      <section className={`p-5 rounded-md ${sectionBg} border ${border} max-w-3xl`}>
        <h3 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold mb-1 flex items-center gap-1.5`}>
          <HardDrive size={11} />
          Storage maintenance
        </h3>
        <p className={`${subColor} text-xs mb-3 leading-relaxed`}>
          Find and delete orphan chat attachments — files in Storage with no matching message. Safe to delete.
        </p>

        {orphanState.kind === 'idle' && (
          <button
            type="button"
            onClick={handleFindOrphans}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonGhost}`}
          >
            Find orphans
          </button>
        )}

        {orphanState.kind === 'counting' && (
          <p className={`${subColor} text-xs inline-flex items-center gap-1.5`}>
            <Loader2 size={12} className="animate-spin" />
            Scanning Storage…
          </p>
        )}

        {orphanState.kind === 'previewed' && orphanState.count === 0 && (
          <div className="space-y-2">
            <p className={`${headingColor} text-sm inline-flex items-center gap-1.5`}>
              <Check size={14} className={isLight ? 'text-emerald-600' : 'text-emerald-400'} />
              Bucket is clean — no orphan files.
            </p>
            <button
              type="button"
              onClick={() => setOrphanState({ kind: 'idle' })}
              className={`text-xs px-2.5 py-1 rounded-md ${buttonGhost}`}
            >
              Done
            </button>
          </div>
        )}

        {orphanState.kind === 'previewed' && orphanState.count > 0 && (
          <div className={`space-y-2 p-3 rounded-md border ${border}`}>
            <p className={`${headingColor} text-sm`}>
              Found {orphanState.count} orphan file{orphanState.count === 1 ? '' : 's'}. Delete all?
            </p>
            <p className={`${subColor} text-[11px]`}>
              This can't be undone.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOrphanState({ kind: 'idle' })}
                className={`text-xs px-3 py-1.5 rounded-md ${buttonGhost}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteOrphans}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                  isLight
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'bg-rose-500 text-white hover:bg-rose-400'
                }`}
              >
                <Trash2 size={12} />
                Delete {orphanState.count} file{orphanState.count === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}

        {orphanState.kind === 'deleting' && (
          <p className={`${subColor} text-xs inline-flex items-center gap-1.5`}>
            <Loader2 size={12} className="animate-spin" />
            Deleting {orphanState.count} file{orphanState.count === 1 ? '' : 's'}…
          </p>
        )}

        {orphanState.kind === 'done' && (
          <div className="space-y-2">
            <p className={`${headingColor} text-sm inline-flex items-center gap-1.5`}>
              <Check size={14} className={isLight ? 'text-emerald-600' : 'text-emerald-400'} />
              Deleted {orphanState.deleted} orphan file{orphanState.deleted === 1 ? '' : 's'}.
            </p>
            <button
              type="button"
              onClick={() => setOrphanState({ kind: 'idle' })}
              className={`text-xs px-2.5 py-1 rounded-md ${buttonGhost}`}
            >
              Done
            </button>
          </div>
        )}

        {orphanState.kind === 'error' && (
          <div className={`px-3 py-2 rounded-md text-xs ${isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'}`}>
            {orphanState.message}{' '}
            <button
              type="button"
              onClick={() => setOrphanState({ kind: 'idle' })}
              className="underline ml-1"
            >
              Reset
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
