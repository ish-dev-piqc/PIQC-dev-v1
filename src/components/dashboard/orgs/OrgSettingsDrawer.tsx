import { useCallback, useEffect, useRef, useState } from 'react';
import { X, UserPlus, Crown, User as UserIcon, Trash2, Copy, Check, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOverlay } from '../../../hooks/useOverlay';
import { useDemoMode } from '../../../context/DemoModeContext';
import {
  buildInviteUrl,
  createOrgInvite,
  currentUserIsOrgAdmin,
  fetchCurrentUserOrg,
  listOrgInvites,
  listOrgMembersWithProfile,
  removeOrgMember,
  updateOrgMemberRole,
} from '../../../lib/orgs/orgsApi';
import type {
  OrgInvite,
  OrgMemberWithProfile,
  OrgRole,
  OrgRow,
} from '../../../types/orgs';

// =============================================================================
// OrgSettingsDrawer — view/manage the current user's primary org.
//
// Two surfaces depending on admin role:
//   - Admin: invite new members, change roles, remove members
//   - Member: read-only roster
//
// Demo mode: read-only "demo mode — org settings are local-only" banner;
// the drawer doesn't touch Supabase.
//
// Moved from src/components/dashboard/site/ as part of the org-workspaces
// refactor — this surface is org management, not Site Mode.
// =============================================================================

interface OrgSettingsDrawerProps {
  onClose: () => void;
}

export default function OrgSettingsDrawer({ onClose }: OrgSettingsDrawerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const overlay = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });
  const { demoActive } = useDemoMode();

  const [org, setOrg] = useState<OrgRow | null>(null);
  const [members, setMembers] = useState<OrgMemberWithProfile[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite-create form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

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

    if (adminFlag) {
      const invitesResult = await listOrgInvites(orgResult.data.id);
      setInvites(invitesResult.ok ? invitesResult.data : []);
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

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || creatingInvite || !inviteEmail.trim()) return;
    setCreatingInvite(true);
    setError(null);
    const result = await createOrgInvite(org.id, inviteEmail.trim(), inviteRole);
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
    refresh();
  };

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

  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
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
            <h2 className={`${headingColor} font-semibold text-base`}>Organization</h2>
            {org && <p className={`${subColor} text-xs mt-0.5`}>{org.name}</p>}
          </div>
          <button type="button" onClick={onClose} className={`${subColor} hover:opacity-75`} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {demoActive ? (
            <div className="p-5">
              <div className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs ${isLight ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-amber-500/[0.06] border border-amber-500/20 text-amber-300'}`}>
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <p>Demo mode — org settings are local-only and don't reflect any real Supabase data.</p>
              </div>
            </div>
          ) : loading ? (
            <div className="p-5">
              <p className={`${subColor} text-sm`}>Loading…</p>
            </div>
          ) : !org ? (
            <div className="p-5">
              <p className={`${headingColor} text-sm`}>No organization linked to your profile.</p>
              <p className={`${subColor} text-xs mt-2 leading-relaxed`}>
                Update your organization name on your profile to be added to a matching org or create a new one.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-inherit">
              {error && (
                <div className={`px-5 py-3 text-xs ${isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'}`}>
                  {error}
                </div>
              )}

              {/* Members */}
              <div className="p-5">
                <h3 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold mb-3`}>
                  Members ({members.length})
                </h3>
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
                          {m.role}
                        </span>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1">
                          {m.role === 'admin' ? (
                            <button type="button" onClick={() => handleRoleChange(m, 'member')} className={`text-[11px] px-2 py-1 rounded ${isLight ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/60 hover:bg-white/[0.05]'}`}>
                              Make member
                            </button>
                          ) : (
                            <button type="button" onClick={() => handleRoleChange(m, 'admin')} className={`text-[11px] px-2 py-1 rounded ${isLight ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/60 hover:bg-white/[0.05]'}`}>
                              Make admin
                            </button>
                          )}
                          <button type="button" onClick={() => handleRemove(m)} className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded ${isLight ? 'text-red-600 hover:bg-red-500/[0.06]' : 'text-red-400 hover:bg-red-500/[0.08]'}`} aria-label={`Remove ${m.name}`}>
                            <Trash2 size={11} />
                            Remove
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Invite section — admin only */}
              {isAdmin && (
                <div className={`p-5 ${sectionBg}`}>
                  <h3 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5`}>
                    <UserPlus size={11} />
                    Invite a member
                  </h3>
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
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <button type="submit" disabled={creatingInvite || !inviteEmail.trim()} className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}>
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
                              <p className={`${mutedColor} text-[11px]`}>{inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}</p>
                            </div>
                            <button type="button" onClick={() => copyInviteUrl(inv.token)} className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded ${isLight ? 'text-brand-600 hover:bg-brand-600/[0.06]' : 'text-brand-300 hover:bg-white/[0.04]'}`}>
                              {copiedToken === inv.token ? <Check size={11} /> : <Copy size={11} />}
                              {copiedToken === inv.token ? 'Copied' : 'Copy link'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
