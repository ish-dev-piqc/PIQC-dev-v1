import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  X,
  AlertCircle,
  ChevronRight,
  Calendar,
  UserCircle2,
  Plus,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useSiteData } from '../../../context/SiteDataContext';
import type { SiteParticipant, ParticipantStatus } from '../../../lib/site/types';
import { PARTICIPANT_STATUS_LABELS } from '../../../lib/site/labels';
import HeatIndicator from '../../heatmap/HeatIndicator';
import { scoreParticipant } from '../../../lib/heatmap';
import ParticipantProfileDrawer from './ParticipantProfileDrawer';
import ParticipantFormDrawer from './ParticipantFormDrawer';
import AuditSignalsBanner from './AuditSignalsBanner';
import ProtocolDetailDrawer from './ProtocolDetailDrawer';
import { Info } from 'lucide-react';

// =============================================================================
// ParticipantsTab — Site Mode list of participants on the active protocol.
//
// ProtocolRequiredGate wraps this — activeProtocol is guaranteed non-null.
// =============================================================================

const STATUS_ORDER: ParticipantStatus[] = [
  'ACTIVE',
  'SCREENING',
  'COMPLETED',
  'WITHDRAWN',
  'SCREEN_FAILURE',
];

type StatusFilter = ParticipantStatus | 'ALL';

export default function ParticipantsTab() {
  const { theme } = useTheme();
  const { activeProtocol, protocols } = useProtocol();
  const { participants, loading, error, refresh } = useSiteData();
  const isLight = theme === 'light';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [openParticipant, setOpenParticipant] = useState<SiteParticipant | null>(null);
  const [formMode, setFormMode] = useState<'create' | null>(null);

  // Deep-link pickup — chat reference chips can drop a participant
  // id/code into `piq-pending-participant-v1` then navigate the user
  // here. Once the participants list is loaded, find the participant
  // (if loaded on the active protocol) and auto-open its profile.
  useEffect(() => {
    if (loading || !participants.length) return;
    let pending: string | null = null;
    try {
      pending = localStorage.getItem('piq-pending-participant-v1');
    } catch {
      /* ignore */
    }
    if (!pending) return;
    const target = participants.find((p) => p.id === pending);
    if (!target) return;
    try {
      localStorage.removeItem('piq-pending-participant-v1');
    } catch {
      /* ignore */
    }
    setOpenParticipant(target);
  }, [loading, participants]);

  // Scope to the active protocol — empty array when no protocol selected so
  // the hooks below can run unconditionally.
  const scoped = useMemo(
    () =>
      activeProtocol
        ? participants.filter((p) => p.protocol_id === activeProtocol.id)
        : [],
    [activeProtocol, participants],
  );

  // Status-filtered + search-filtered + sorted
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped
      .filter((p) => statusFilter === 'ALL' || p.status === statusFilter)
      .filter((p) =>
        q
          ? p.id.toLowerCase().includes(q) ||
            p.assigned_coordinator.toLowerCase().includes(q)
          : true,
      )
      .sort((a, b) => {
        // Active first, then by status order; within a status, by ID
        const aIdx = STATUS_ORDER.indexOf(a.status);
        const bIdx = STATUS_ORDER.indexOf(b.status);
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a.id.localeCompare(b.id);
      });
  }, [scoped, statusFilter, search]);

  // Status counts for the filter row
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      ALL: scoped.length,
      ACTIVE: 0,
      SCREENING: 0,
      COMPLETED: 0,
      WITHDRAWN: 0,
      SCREEN_FAILURE: 0,
    };
    for (const p of scoped) c[p.status]++;
    return c;
  }, [scoped]);

  const [detailOpen, setDetailOpen] = useState(false);

  // Defer the no-protocol guard until after hooks are declared.
  if (!activeProtocol) return null;

  // Theme tokens
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const inputBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const inputBorder = isLight
    ? 'border-[#CBD5E1] focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
    : 'border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30';
  const filterActive = isLight
    ? 'bg-brand-600/10 border-brand-600 text-brand-600'
    : 'bg-brand-600/15 border-brand-300 text-brand-300';
  const filterInactive = isLight
    ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:border-[#CBD5E1] hover:text-[#0F172A]'
    : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]/55 hover:border-white/20 hover:text-[#CBD5E1]';
  const rowHover = isLight ? 'hover:bg-[#F8FAFC]' : 'hover:bg-white/[0.02]';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5 overflow-y-auto h-full">
      <AuditSignalsBanner protocolId={activeProtocol.id} />
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1`}>
            {activeProtocol.code}
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="opacity-60 hover:opacity-100"
              aria-label="Protocol details"
              title="Protocol details"
            >
              <Info size={11} />
            </button>
          </p>
          <h2 className={`${headingColor} text-xl font-semibold mt-1`}>Participants</h2>
          <p className={`${subColor} text-sm mt-1`}>
            Everyone enrolled on this protocol, at a glance.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <p className={`${subColor} text-sm`}>
            {scoped.length} total · {counts.ACTIVE} active
          </p>
          <button
            type="button"
            onClick={() => setFormMode('create')}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md text-white transition-colors ${
              isLight ? 'bg-brand-600 hover:bg-brand-800' : 'bg-brand-300 hover:bg-brand-400'
            }`}
          >
            <Plus size={13} />
            New participant
          </button>
        </div>
      </div>

      {error && (
        <div
          className={`border rounded-md px-3 py-2 text-xs ${
            isLight ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-rose-500/[0.06] border-rose-500/20 text-rose-300'
          }`}
        >
          Failed to load participants: {error}
        </div>
      )}

      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['ALL', ...STATUS_ORDER] as StatusFilter[]).map((s) => {
          const isActive = statusFilter === s;
          const label = s === 'ALL' ? 'All' : PARTICIPANT_STATUS_LABELS[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors ${isActive ? filterActive : filterInactive}`}
            >
              {label}
              <span
                className={`text-[10px] font-semibold px-1 rounded ${
                  isActive
                    ? isLight
                      ? 'bg-brand-600/20'
                      : 'bg-brand-300/20'
                    : isLight
                    ? 'bg-[#0F172A]/[0.04]'
                    : 'bg-white/[0.06]'
                }`}
              >
                {counts[s]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search
          size={14}
          className={`absolute left-3 top-1/2 -translate-y-1/2 ${mutedColor}`}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ID or coordinator…"
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

      {/* List */}
      {visible.length === 0 ? (
        <div
          className={`${cardBg} border rounded-xl px-6 py-10 text-center border-dashed`}
        >
          <UserCircle2 className={`mx-auto mb-2 ${mutedColor}`} size={28} />
          <p className={`${subColor} text-sm`}>
            {loading
              ? 'Loading participants…'
              : search
                ? 'No participants match your search.'
                : scoped.length === 0
                  ? "No participants yet. They aren't pulled from the protocol PDF — add each one as they enroll."
                  : 'No participants in this status.'}
          </p>
          {!loading && !search && scoped.length === 0 && (
            <button
              type="button"
              onClick={() => setFormMode('create')}
              className={`mt-4 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md text-white transition-colors ${
                isLight ? 'bg-brand-600 hover:bg-brand-800' : 'bg-brand-300 hover:bg-brand-400'
              }`}
            >
              <Plus size={13} />
              Add first participant
            </button>
          )}
        </div>
      ) : (
        <div className={`${cardBg} border rounded-xl overflow-hidden`}>
          <div
            className={`grid grid-cols-[80px,1fr,auto,auto] sm:grid-cols-[100px,1fr,160px,140px] gap-3 px-4 py-2.5 border-b ${
              isLight ? 'border-[#F2F2F2] bg-[#F8FAFC]' : 'border-white/[0.04] bg-white/[0.02]'
            }`}
          >
            <span className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>ID</span>
            <span className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>Status & next visit</span>
            <span className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold hidden sm:block`}>
              Coordinator
            </span>
            <span className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold hidden sm:block`}>
              Day
            </span>
          </div>
          <div className={`divide-y ${isLight ? 'divide-[#F2F2F2]' : 'divide-white/[0.03]'}`}>
            {visible.map((p) => (
              <ParticipantRow
                key={p.id}
                participant={p}
                onClick={() => setOpenParticipant(p)}
                isLight={isLight}
                rowHover={rowHover}
                headingColor={headingColor}
                subColor={subColor}
                mutedColor={mutedColor}
              />
            ))}
          </div>
        </div>
      )}

      {openParticipant && (
        <ParticipantProfileDrawer
          participantId={openParticipant.id}
          protocols={protocols}
          onClose={() => setOpenParticipant(null)}
        />
      )}

      {formMode === 'create' && (
        <ParticipantFormDrawer
          mode="create"
          protocolId={activeProtocol.id}
          protocolCode={activeProtocol.code}
          onSaved={() => {
            // Refetch directly instead of relying on the postgres_changes
            // subscription. The realtime channel has been intermittently
            // not firing for INSERTs on site_participants in prod; an
            // explicit refresh guarantees the new row shows up immediately
            // rather than waiting for the user to refresh the page.
            refresh();
          }}
          onClose={() => setFormMode(null)}
        />
      )}
      <ProtocolDetailDrawer
        protocolId={detailOpen ? activeProtocol.id : null}
        protocolCode={activeProtocol.code}
        protocolTitle={activeProtocol.name}
        protocolSponsor={activeProtocol.sponsor}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
}

// ============================================================================
// ParticipantRow
// ============================================================================

interface ParticipantRowProps {
  participant: SiteParticipant;
  onClick: () => void;
  isLight: boolean;
  rowHover: string;
  headingColor: string;
  subColor: string;
  mutedColor: string;
}

function ParticipantRow({
  participant,
  onClick,
  isLight,
  rowHover,
  headingColor,
  subColor,
  mutedColor,
}: ParticipantRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left grid grid-cols-[80px,1fr,auto,auto] sm:grid-cols-[100px,1fr,160px,140px] items-center gap-3 px-4 py-3 ${rowHover} transition-colors`}
    >
      <span className={`${headingColor} text-sm font-semibold`}>{participant.id}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusChip status={participant.status} isLight={isLight} />
          {participant.open_deviations > 0 && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                isLight
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
              }`}
            >
              <AlertCircle size={10} />
              {participant.open_deviations} open
            </span>
          )}
          {(() => {
            // Hide the heat chip for participants with no real risk signal
            // (default-state active/screening rows). The chip is meaningful
            // for `moderate`/`high` — open deviations or withdrawn status —
            // not for "we have nothing on this person."
            const score = scoreParticipant(participant);
            if (score !== 'moderate' && score !== 'high') return null;
            return (
              <HeatIndicator
                score={score}
                variant="chip"
                hint="cross-study deviation/dropout pattern"
              />
            );
          })()}
        </div>
        {participant.next_visit_date && (
          <div className={`flex items-center gap-1.5 mt-1 text-xs ${subColor}`}>
            <Calendar size={11} />
            <span>{formatDate(participant.next_visit_date)}</span>
            <span className={mutedColor}>·</span>
            <span className="truncate">{participant.next_visit_name ?? '—'}</span>
          </div>
        )}
      </div>
      <span className={`text-xs ${subColor} hidden sm:block truncate`}>
        {participant.assigned_coordinator}
      </span>
      <span className={`text-xs ${subColor} hidden sm:flex items-center gap-2`}>
        {participant.current_study_day !== null ? (
          <>
            <span className={`${mutedColor}`}>Day</span>
            <span className={`${headingColor} font-semibold`}>
              {participant.current_study_day}
            </span>
          </>
        ) : participant.enrolled_at === null ? (
          <span className={mutedColor}>Not enrolled</span>
        ) : (
          <span className={mutedColor}>—</span>
        )}
        <ChevronRight size={14} className={mutedColor} />
      </span>
    </button>
  );
}

// ============================================================================
// StatusChip
// ============================================================================

function StatusChip({
  status,
  isLight,
}: {
  status: ParticipantStatus;
  isLight: boolean;
}) {
  const tones: Record<ParticipantStatus, string> = {
    ACTIVE: isLight
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    SCREENING: isLight
      ? 'bg-brand-600/10 border-brand-600/25 text-brand-600'
      : 'bg-brand-300/15 border-brand-300/30 text-brand-300',
    COMPLETED: isLight
      ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/70'
      : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/65',
    WITHDRAWN: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    SCREEN_FAILURE: isLight
      ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/55'
      : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/45',
  };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tones[status]}`}
    >
      {PARTICIPANT_STATUS_LABELS[status]}
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
