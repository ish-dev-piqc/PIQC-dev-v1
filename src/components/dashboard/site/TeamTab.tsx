import { useMemo, useState } from 'react';
import {
  Search,
  X,
  AlertTriangle,
  Mail,
  Calendar,
  Users,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useSiteData } from '../../../context/SiteDataContext';
import { TEAM_ROLE_LABELS, TEAM_ROLE_SHORT } from '../../../lib/site/labels';
import { deleteTeamMember } from '../../../lib/site/siteApi';
import { isCertExpired, isCertExpiringSoon } from '../../../lib/site/dateUtils';
import TeamFormDrawer from './TeamFormDrawer';
import type {
  SiteTeamMember,
  TeamRole,
  TeamMemberStatus,
} from '../../../lib/site/types';

// =============================================================================
// TeamTab — Site Mode delegation log for the active protocol.
//
// Shows site staff with their role, delegated tasks, and certification status.
// Inactive members show greyed-out with reason. Search by name; filter by role.
//
// ProtocolRequiredGate ensures activeProtocol is non-null.
// =============================================================================

const ROLE_ORDER: TeamRole[] = [
  'PI',
  'SUB_I',
  'COORDINATOR',
  'NURSE',
  'PHARMACIST',
  'MONITOR',
];

type RoleFilter = TeamRole | 'ALL';

export default function TeamTab() {
  const { theme } = useTheme();
  const { activeProtocol } = useProtocol();
  const { teamMembers, loading, error } = useSiteData();
  const isLight = theme === 'light';

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
  const [showInactive, setShowInactive] = useState(true);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editTarget, setEditTarget] = useState<SiteTeamMember | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (member: SiteTeamMember) => {
    if (deleting) return;
    const confirmed = window.confirm(`Remove ${member.name} from the team?`);
    if (!confirmed) return;
    setDeleting(member.id);
    await deleteTeamMember(member.id);
    setDeleting(null);
  };

  // Scope to the active protocol — empty array when no protocol selected so
  // the hooks below can run unconditionally. The context also pre-filters by
  // active protocol, but we re-filter defensively in case scope drifts.
  const scoped = useMemo(
    () =>
      activeProtocol
        ? teamMembers.filter((m) => m.protocol_id === activeProtocol.id)
        : [],
    [activeProtocol, teamMembers],
  );

  // Filter + search
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped
      .filter((m) => (showInactive ? true : m.status === 'ACTIVE'))
      .filter((m) => roleFilter === 'ALL' || m.role === roleFilter)
      .filter((m) =>
        q
          ? m.name.toLowerCase().includes(q) ||
            m.email.toLowerCase().includes(q) ||
            m.delegated_tasks.some((t) => t.toLowerCase().includes(q))
          : true,
      )
      .sort((a, b) => {
        // Active first, then by role order
        if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
        const aIdx = ROLE_ORDER.indexOf(a.role);
        const bIdx = ROLE_ORDER.indexOf(b.role);
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a.name.localeCompare(b.name);
      });
  }, [scoped, search, roleFilter, showInactive]);

  // Counts for the filter row
  const counts = useMemo(() => {
    const c: Record<RoleFilter, number> = {
      ALL: scoped.length,
      PI: 0,
      SUB_I: 0,
      COORDINATOR: 0,
      NURSE: 0,
      PHARMACIST: 0,
      MONITOR: 0,
    };
    for (const m of scoped) c[m.role]++;
    return c;
  }, [scoped]);

  const expiringSoon = useMemo(
    () => scoped.filter((m) => isCertExpiringSoon(m.certified_through)),
    [scoped],
  );

  // Defer the no-protocol guard until after all hooks are declared.
  if (!activeProtocol) return null;

  // Theme tokens
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const inputBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const inputBorder = isLight
    ? 'border-[#CBD5E1] focus:border-[#017BC8] focus:ring-1 focus:ring-[#017BC8]/30'
    : 'border-white/15 focus:border-[#74B4DC] focus:ring-1 focus:ring-[#74B4DC]/30';
  const filterActive = isLight
    ? 'bg-[#017BC8]/10 border-[#017BC8] text-[#017BC8]'
    : 'bg-[#017BC8]/15 border-[#74B4DC] text-[#74B4DC]';
  const filterInactive = isLight
    ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:border-[#CBD5E1] hover:text-[#0F172A]'
    : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]/55 hover:border-white/20 hover:text-[#CBD5E1]';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
            {activeProtocol.code}
          </p>
          <h2 className={`${headingColor} text-xl font-semibold mt-1`}>Team</h2>
          <p className={`${subColor} text-sm mt-1`}>
            Site staff and the delegation log for this protocol.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <p className={`${subColor} text-sm`}>
            {scoped.length} total ·{' '}
            {scoped.filter((m) => m.status === 'ACTIVE').length} active
          </p>
          <button
            type="button"
            onClick={() => {
              setEditTarget(null);
              setFormMode('create');
            }}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
              isLight
                ? 'bg-[#017BC8] text-white hover:bg-[#0477BF]'
                : 'bg-[#74B4DC] text-[#0F172A] hover:bg-[#026BBE]'
            }`}
          >
            <Plus size={13} />
            Add team member
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className={`border rounded-md px-3 py-2 text-xs ${
            isLight ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-rose-500/[0.06] border-rose-500/20 text-rose-300'
          }`}
        >
          Failed to load team data: {error}
        </div>
      )}

      {/* Cert-expiring callout */}
      {expiringSoon.length > 0 && (
        <div
          className={`border rounded-md px-3 py-2 ${
            isLight
              ? 'bg-amber-50 border-amber-200/80'
              : 'bg-amber-500/[0.06] border-amber-500/15'
          }`}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className={`${headingColor} text-sm font-medium`}>
                {expiringSoon.length}{' '}
                {expiringSoon.length === 1 ? 'team member has' : 'team members have'}{' '}
                certifications expiring within 30 days
              </p>
              <p className={`${subColor} text-xs mt-0.5`}>
                {expiringSoon.map((m) => m.name).join(', ')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Role filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['ALL', ...ROLE_ORDER] as RoleFilter[]).map((r) => {
          const isActive = roleFilter === r;
          const label = r === 'ALL' ? 'All' : TEAM_ROLE_SHORT[r];
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors ${isActive ? filterActive : filterInactive}`}
            >
              {label}
              <span
                className={`text-[10px] font-semibold px-1 rounded ${
                  isActive
                    ? isLight
                      ? 'bg-[#017BC8]/20'
                      : 'bg-[#74B4DC]/20'
                    : isLight
                    ? 'bg-[#0F172A]/[0.04]'
                    : 'bg-white/[0.06]'
                }`}
              >
                {counts[r]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search + show inactive toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search
            size={14}
            className={`absolute left-3 top-1/2 -translate-y-1/2 ${mutedColor}`}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or delegated task…"
            className={`w-full rounded-md border pl-9 pr-9 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className={`absolute right-3 top-1/2 -translate-y-1/2 ${mutedColor} hover:opacity-75`}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <label
          className={`inline-flex items-center gap-2 text-xs ${headingColor} cursor-pointer select-none`}
        >
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show inactive
        </label>
      </div>

      {/* Member list */}
      {visible.length === 0 ? (
        <div className={`${cardBg} border rounded-xl px-6 py-10 text-center border-dashed`}>
          <Users className={`mx-auto mb-2 ${mutedColor}`} size={28} />
          <p className={`${subColor} text-sm`}>
            {loading
              ? 'Loading team…'
              : search
                ? 'No team members match your search.'
                : scoped.length === 0
                  ? "Team rosters aren't in the protocol PDF — add the people running this trial. Click “Add team member” to start."
                  : 'No team members in this view.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((m) => (
            <TeamCard
              key={m.id}
              member={m}
              isLight={isLight}
              cardBg={cardBg}
              headingColor={headingColor}
              subColor={subColor}
              mutedColor={mutedColor}
              onEdit={(member) => {
                setEditTarget(member);
                setFormMode('edit');
              }}
              onDelete={handleDelete}
              deleting={deleting === m.id}
            />
          ))}
        </div>
      )}

      {formMode && (
        <TeamFormDrawer
          mode={formMode}
          protocolId={activeProtocol.id}
          initial={editTarget ?? undefined}
          onClose={() => {
            setFormMode(null);
            setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// TeamCard
// ============================================================================

interface TeamCardProps {
  member: SiteTeamMember;
  isLight: boolean;
  cardBg: string;
  headingColor: string;
  subColor: string;
  mutedColor: string;
  onEdit: (m: SiteTeamMember) => void;
  onDelete: (m: SiteTeamMember) => void;
  deleting: boolean;
}

function TeamCard({ member, isLight, cardBg, headingColor, subColor, mutedColor, onEdit, onDelete, deleting }: TeamCardProps) {
  const isInactive = member.status === 'INACTIVE';
  const certExpired = isCertExpired(member.certified_through);
  const certExpiring = !certExpired && isCertExpiringSoon(member.certified_through);

  const opacity = isInactive ? 'opacity-65' : '';

  return (
    <div className={`${cardBg} border rounded-lg p-4 ${opacity}`}>
      {/* Header: name + role + status */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`${headingColor} text-base font-semibold truncate`}>
              {member.name}
            </h3>
            <RoleChip role={member.role} isLight={isLight} />
            <StatusChip status={member.status} isLight={isLight} />
          </div>
          <a
            href={`mailto:${member.email}`}
            className={`inline-flex items-center gap-1.5 text-xs ${subColor} hover:underline mt-0.5`}
            onClick={(e) => e.stopPropagation()}
          >
            <Mail size={11} />
            {member.email}
          </a>
        </div>
        <div className={`text-right text-xs ${subColor}`}>
          <div className="flex items-center gap-1.5">
            <Calendar size={11} />
            <span>
              GCP cert {certExpired ? 'expired' : 'through'}{' '}
              <span
                className={
                  certExpired || certExpiring
                    ? isLight
                      ? 'text-amber-700 font-semibold'
                      : 'text-amber-300 font-semibold'
                    : headingColor
                }
              >
                {formatDate(member.certified_through)}
              </span>
            </span>
          </div>
          {certExpiring && (
            <p className={`${isLight ? 'text-amber-700' : 'text-amber-300'} text-[11px] mt-0.5`}>
              Expiring within 30 days
            </p>
          )}
          {certExpired && (
            <p className={`${isLight ? 'text-red-600' : 'text-red-400'} text-[11px] mt-0.5`}>
              Cert expired
            </p>
          )}
        </div>
      </div>

      {/* Delegated tasks */}
      {member.delegated_tasks.length > 0 ? (
        <div className="mt-3">
          <p className={`text-[10px] uppercase tracking-wider font-semibold mb-1.5 ${mutedColor}`}>
            Delegated tasks
          </p>
          <div className="flex flex-wrap gap-1.5">
            {member.delegated_tasks.map((t, i) => (
              <span
                key={`${t}-${i}`}
                className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded border ${
                  isLight
                    ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/75'
                    : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/65'
                }`}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className={`text-xs italic mt-2 ${mutedColor}`}>No site-level delegated tasks.</p>
      )}

      {/* Notes */}
      {member.notes && (
        <p className={`text-xs mt-3 leading-relaxed ${subColor}`}>{member.notes}</p>
      )}

      {/* Footer + actions */}
      <div className={`flex items-center justify-between mt-3 pt-3 border-t ${isLight ? 'border-[#F2F2F2]' : 'border-white/[0.04]'}`}>
        <p className={`text-[11px] ${mutedColor}`}>
          Joined protocol {formatDate(member.added_at)}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(member)}
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors ${
              isLight ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/60 hover:bg-white/[0.05]'
            }`}
            aria-label={`Edit ${member.name}`}
          >
            <Pencil size={11} />
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(member)}
            disabled={deleting}
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors ${
              isLight ? 'text-red-600 hover:bg-red-500/[0.06]' : 'text-red-400 hover:bg-red-500/[0.08]'
            } disabled:opacity-50`}
            aria-label={`Remove ${member.name}`}
          >
            <Trash2 size={11} />
            {deleting ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Chips
// ============================================================================

function RoleChip({ role, isLight }: { role: TeamRole; isLight: boolean }) {
  const tones: Record<TeamRole, string> = {
    PI: isLight
      ? 'bg-[#017BC8]/10 border-[#017BC8]/25 text-[#017BC8]'
      : 'bg-[#74B4DC]/15 border-[#74B4DC]/30 text-[#74B4DC]',
    SUB_I: isLight
      ? 'bg-[#017BC8]/10 border-[#017BC8]/25 text-[#017BC8]'
      : 'bg-[#74B4DC]/15 border-[#74B4DC]/30 text-[#74B4DC]',
    COORDINATOR: isLight
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    NURSE: isLight
      ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/70'
      : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/65',
    PHARMACIST: isLight
      ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/70'
      : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/65',
    MONITOR: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
  };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tones[role]}`}
      title={TEAM_ROLE_LABELS[role]}
    >
      {TEAM_ROLE_SHORT[role]}
    </span>
  );
}

function StatusChip({ status, isLight }: { status: TeamMemberStatus; isLight: boolean }) {
  if (status === 'ACTIVE') return null;
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
        isLight
          ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/55'
          : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/45'
      }`}
    >
      Inactive
    </span>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
