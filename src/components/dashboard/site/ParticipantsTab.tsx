import { useMemo, useState } from 'react';
import {
  Search,
  X,
  AlertCircle,
  ChevronRight,
  Calendar,
  UserCircle2,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import {
  MOCK_PARTICIPANTS,
  PARTICIPANT_STATUS_LABELS,
  type MockParticipant,
  type ParticipantStatus,
} from '../../../lib/mockSiteData';
import HeatIndicator from '../../heatmap/HeatIndicator';
import { scoreParticipant } from '../../../lib/heatmap';
import ParticipantProfileDrawer from './ParticipantProfileDrawer';

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
  const isLight = theme === 'light';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [openParticipant, setOpenParticipant] = useState<MockParticipant | null>(null);

  // Scope to the active protocol — empty array when no protocol selected so
  // the hooks below can run unconditionally.
  const scoped = useMemo(
    () =>
      activeProtocol
        ? MOCK_PARTICIPANTS.filter((p) => p.protocol_id === activeProtocol.id)
        : [],
    [activeProtocol],
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

  // Defer the no-protocol guard until after hooks are declared.
  if (!activeProtocol) return null;

  // Theme tokens
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const inputBg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const inputBorder = isLight
    ? 'border-[#cbd2db] focus:border-[#4a6fa5] focus:ring-1 focus:ring-[#4a6fa5]/30'
    : 'border-white/15 focus:border-[#6e8fb5] focus:ring-1 focus:ring-[#6e8fb5]/30';
  const filterActive = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5] text-[#4a6fa5]'
    : 'bg-[#4a6fa5]/15 border-[#6e8fb5] text-[#6e8fb5]';
  const filterInactive = isLight
    ? 'bg-white border-[#e2e8ee] text-[#374152]/65 hover:border-[#cbd2db] hover:text-[#1a1f28]'
    : 'bg-[#131a22] border-white/10 text-[#d2d7e0]/55 hover:border-white/20 hover:text-[#d2d7e0]';
  const rowHover = isLight ? 'hover:bg-[#f5f7fa]' : 'hover:bg-white/[0.02]';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
            {activeProtocol.code}
          </p>
          <h2 className={`${headingColor} text-xl font-semibold mt-1`}>Participants</h2>
          <p className={`${subColor} text-sm mt-1`}>
            Everyone enrolled on this protocol and where they stand.
          </p>
        </div>
        <p className={`${subColor} text-sm`}>
          {scoped.length} total · {counts.ACTIVE} active
        </p>
      </div>

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
                      ? 'bg-[#4a6fa5]/20'
                      : 'bg-[#6e8fb5]/20'
                    : isLight
                    ? 'bg-[#1a1f28]/[0.04]'
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
            {search ? 'No participants match your search.' : 'No participants in this status.'}
          </p>
        </div>
      ) : (
        <div className={`${cardBg} border rounded-xl overflow-hidden`}>
          <div
            className={`grid grid-cols-[80px,1fr,auto,auto] sm:grid-cols-[100px,1fr,160px,140px] gap-3 px-4 py-2.5 border-b ${
              isLight ? 'border-[#eef2f6] bg-[#f9fafc]' : 'border-white/[0.04] bg-white/[0.02]'
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
          <div className={`divide-y ${isLight ? 'divide-[#f0f4f8]' : 'divide-white/[0.03]'}`}>
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
    </div>
  );
}

// ============================================================================
// ParticipantRow
// ============================================================================

interface ParticipantRowProps {
  participant: MockParticipant;
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
          <HeatIndicator
            score={scoreParticipant(participant)}
            variant="chip"
            hint="cross-study deviation/dropout pattern"
          />
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
      ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]'
      : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
    COMPLETED: isLight
      ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/70'
      : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/65',
    WITHDRAWN: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    SCREEN_FAILURE: isLight
      ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/55'
      : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/45',
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
