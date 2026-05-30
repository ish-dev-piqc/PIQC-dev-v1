import { useEffect, useMemo, useRef, useState } from 'react';
import { X, UserPlus, Crown, User as UserIcon, Eye, Trash2 } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOverlay } from '../../../hooks/useOverlay';
import { useOrg } from '../../../context/OrgContext';
import { useProtocol } from '../../../context/ProtocolContext';
import {
  addProtocolMember,
  removeProtocolMember,
  updateProtocolMemberRole,
} from '../../../lib/orgs/orgsApi';
import { listOrgMembers as listOrgMembersWithProfile, type OrgMember as OrgMemberWithProfile } from '../../../lib/orgs/orgApi';
import type { ProtocolMember, ProtocolMemberRole } from '../../../types/orgs';
import AccessRequestsList from './AccessRequestsList';

// =============================================================================
// MembersDrawer — per-protocol member management.
//
// Coordinator view: invite from the owning org's roster, change roles,
// remove members, see + handle pending access requests, see + manage guests.
// Non-coordinator view: read-only roster.
//
// Data flows entirely through OrgContext (no direct supabase imports).
// =============================================================================

interface MembersDrawerProps {
  onClose: () => void;
}

const ROLE_OPTIONS: { value: ProtocolMemberRole; label: string; icon: typeof Crown }[] = [
  { value: 'coordinator', label: 'Coordinator', icon: Crown },
  { value: 'member', label: 'Member', icon: UserIcon },
  { value: 'viewer', label: 'Viewer', icon: Eye },
];

export default function MembersDrawer({ onClose }: MembersDrawerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { activeProtocol } = useProtocol();
  const { protocolMembers, currentUserId, protocolOwnerOrgId, refresh } = useOrg();
  const overlay = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });

  const [orgRoster, setOrgRoster] = useState<OrgMemberWithProfile[]>([]);
  const [orgRosterLoaded, setOrgRosterLoaded] = useState(false);
  const [inviteUserId, setInviteUserId] = useState<string>('');
  const [inviteRole, setInviteRole] = useState<ProtocolMemberRole>('member');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callerIsCoordinator = useMemo(
    () =>
      currentUserId !== null &&
      protocolMembers.some((m) => m.role === 'coordinator' && m.user_id === currentUserId),
    [protocolMembers, currentUserId],
  );

  // Lazy-load the org roster when the drawer mounts for a coordinator.
  // OrgContext provides owner_org_id; if it's not loaded yet, the effect
  // re-runs when it is.
  useEffect(() => {
    if (!callerIsCoordinator || orgRosterLoaded || !protocolOwnerOrgId) return;
    let cancelled = false;
    listOrgMembersWithProfile(protocolOwnerOrgId).then((res) => {
      if (cancelled) return;
      setOrgRosterLoaded(true);
      if (res.ok) setOrgRoster(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [callerIsCoordinator, orgRosterLoaded, protocolOwnerOrgId]);

  const memberUserIds = useMemo(
    () => new Set(protocolMembers.map((m) => m.user_id)),
    [protocolMembers],
  );

  const addableOrgMembers = useMemo(
    () => orgRoster.filter((om) => !memberUserIds.has(om.user_id)),
    [orgRoster, memberUserIds],
  );

  async function handleAdd() {
    if (!activeProtocol || !inviteUserId || working) return;
    setWorking(true);
    setError(null);
    const res = await addProtocolMember({
      protocol_id: activeProtocol.id,
      user_id: inviteUserId,
      role: inviteRole,
    });
    setWorking(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setInviteUserId('');
    setInviteRole('member');
    refresh();
  }

  async function handleRoleChange(member: ProtocolMember, role: ProtocolMemberRole) {
    if (!activeProtocol || working) return;
    setError(null);
    const res = await updateProtocolMemberRole(activeProtocol.id, member.user_id, { role });
    if (!res.ok) setError(res.error);
    else refresh();
  }

  async function handleRemove(member: ProtocolMember) {
    if (!activeProtocol || working) return;
    const profileName = orgRoster.find((o) => o.user_id === member.user_id)?.name ?? member.user_id;
    if (!window.confirm(`Remove ${profileName} from this protocol?`)) return;
    setError(null);
    const res = await removeProtocolMember(activeProtocol.id, member.user_id);
    if (!res.ok) setError(res.error);
    else refresh();
  }

  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-brand-600/50'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-brand-300/50';

  return (
    <div
      ref={overlay}
      onClick={(e) => {
        if (e.target === overlay.current) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/30 flex justify-end animate-fade-in"
    >
      <div
        ref={panelRef}
        className={`w-full max-w-lg h-full ${bg} border-l ${border} shadow-xl flex flex-col animate-slide-in-right`}
      >
        <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
          <div>
            <h2 className="text-fg-heading font-semibold text-base">Protocol members</h2>
            {activeProtocol && (
              <p className={`${subColor} text-xs mt-0.5`}>
                {activeProtocol.code} — {activeProtocol.name}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`${subColor} hover:opacity-75`}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-inherit">
          {error && (
            <div
              className={`px-5 py-3 text-xs ${isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'}`}
            >
              {error}
            </div>
          )}

          {/* Add member */}
          {callerIsCoordinator && (
            <div className="p-5">
              <h3 className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-3">
                Add member
              </h3>
              {addableOrgMembers.length === 0 ? (
                <p className={`${mutedColor} text-xs`}>
                  Everyone in this org is already a member of this protocol.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <select
                    value={inviteUserId}
                    onChange={(e) => setInviteUserId(e.target.value)}
                    className={`text-sm rounded-md border px-3 py-2 ${inputBg} text-fg-body`}
                  >
                    <option value="">Select a user…</option>
                    {addableOrgMembers.map((om) => (
                      <option key={om.user_id} value={om.user_id}>
                        {om.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as ProtocolMemberRole)}
                    className={`text-sm rounded-md border px-3 py-2 ${inputBg} text-fg-body`}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!inviteUserId || working}
                    className={`text-sm rounded-md px-3 py-2 inline-flex items-center justify-center gap-1.5 ${buttonPrimary}`}
                  >
                    <UserPlus size={14} />
                    Add
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Roster */}
          <div className="p-5">
            <h3 className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-3">
              Members ({protocolMembers.length})
            </h3>
            <ul className="space-y-1.5">
              {protocolMembers.map((m) => {
                const profile = orgRoster.find((o) => o.user_id === m.user_id);
                return (
                  <li
                    key={m.user_id}
                    className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border ${border}`}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <p className="text-sm text-fg-body truncate">{profile?.name ?? m.user_id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {callerIsCoordinator ? (
                        <select
                          value={m.role}
                          onChange={(e) =>
                            handleRoleChange(m, e.target.value as ProtocolMemberRole)
                          }
                          className={`text-xs rounded-md border px-2 py-1 ${inputBg} text-fg-body`}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`text-xs ${mutedColor}`}>{m.role}</span>
                      )}
                      {callerIsCoordinator && (
                        <button
                          type="button"
                          onClick={() => handleRemove(m)}
                          className={`${subColor} hover:text-rose-500`}
                          aria-label="Remove member"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Pending access requests (coordinator-only) */}
          {callerIsCoordinator && <AccessRequestsList />}
        </div>
      </div>
    </div>
  );
}

