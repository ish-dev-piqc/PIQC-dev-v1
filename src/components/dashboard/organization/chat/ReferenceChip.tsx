import { useState } from 'react';
import {
  CalendarCheck,
  ClipboardList,
  User as UserIcon,
} from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useProtocol } from '../../../../context/ProtocolContext';
import { useSiteData } from '../../../../context/SiteDataContext';
import ReferencePopover, { type ReferencePopoverPayload } from './ReferencePopover';

// =============================================================================
// ReferenceChip — single inline chip for a `[type:id]` token in a chat
// message. Three kinds: protocol, participant, visit.
//
// Click behavior:
//   - protocol: setActiveProtocol(...) — quick context switch.
//   - participant / visit: opens a small inline ReferencePopover with the
//     resource's summary (resolved from useSiteData if loaded; otherwise
//     a "Not loaded" message). v2 will wire full cross-tab navigation
//     ("Go to visit" jumps to the visit-execution drawer, etc.).
// =============================================================================

export type ReferenceKind = 'protocol' | 'participant' | 'visit';

interface ReferenceChipProps {
  kind: ReferenceKind;
  /** The token's id payload: study_number / participant_code / visit_uuid. */
  refId: string;
}

export default function ReferenceChip({ kind, refId }: ReferenceChipProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { protocols, setActiveProtocol } = useProtocol();
  const { visits, participants } = useSiteData();
  const [popover, setPopover] = useState<ReferencePopoverPayload | null>(null);

  // Resolve display text + popover payload from local data.
  let displayText = `${kind}:${refId}`;
  let icon: React.ReactNode;
  let resolved = true;
  let onClick: () => void;

  if (kind === 'protocol') {
    icon = <ClipboardList size={11} />;
    const proto = protocols.find((p) => p.code === refId);
    displayText = proto ? proto.code : refId;
    resolved = !!proto;
    onClick = () => {
      if (proto) setActiveProtocol(proto);
    };
  } else if (kind === 'participant') {
    icon = <UserIcon size={11} />;
    const part = participants.find((p) => p.id === refId);
    displayText = part ? part.id : refId;
    resolved = !!part;
    onClick = () => {
      setPopover({
        kind: 'participant',
        title: part ? `${part.id}` : `${refId} (not loaded)`,
        refId,
        resolved: !!part,
        rows: part
          ? [
              ['Status', part.status],
              ['Enrolled', part.enrolled_at ?? '—'],
              ['Study day', String(part.current_study_day ?? '—')],
              ['Next visit', part.next_visit_name ?? '—'],
              ['Next visit date', part.next_visit_date ?? '—'],
              ['Coordinator', part.assigned_coordinator || '—'],
            ]
          : [['', 'Participant not loaded — switch to the right protocol to view details.']],
      });
    };
  } else {
    icon = <CalendarCheck size={11} />;
    const visit = visits.find((v) => v.id === refId);
    displayText = visit
      ? `${visit.visitName} · ${visit.participantId}`
      : 'Visit (not loaded)';
    resolved = !!visit;
    onClick = () => {
      setPopover({
        kind: 'visit',
        title: visit ? visit.visitName : `${refId} (not loaded)`,
        refId,
        resolved: !!visit,
        rows: visit
          ? [
              ['Participant', visit.participantId],
              ['Study day', String(visit.studyDay)],
              ['Date', visit.date],
              ['Status', visit.status],
              ...(visit.time ? [['Time', visit.time] as [string, string]] : []),
            ]
          : [['', 'Visit not loaded — switch to the right protocol to view details.']],
      });
    };
  }

  // Per-kind chip color: protocols match brand; participants emerald;
  // visits indigo. "Not loaded" rows render muted regardless of kind.
  let chipClass: string;
  if (!resolved) {
    chipClass = isLight
      ? 'bg-[#F2F2F2] text-[#334155]/70 border-[#E2E8F0]'
      : 'bg-white/[0.06] text-[#CBD5E1]/55 border-white/10';
  } else if (kind === 'protocol') {
    chipClass = isLight
      ? 'bg-brand-600/[0.10] text-brand-600 border-brand-600/20'
      : 'bg-brand-300/[0.15] text-brand-300 border-brand-300/25';
  } else if (kind === 'participant') {
    chipClass = isLight
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-emerald-500/[0.15] text-emerald-300 border-emerald-500/30';
  } else {
    chipClass = isLight
      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
      : 'bg-indigo-500/[0.15] text-indigo-300 border-indigo-500/30';
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 text-[11px] font-medium rounded border px-1.5 py-0.5 align-baseline ${chipClass} hover:opacity-80`}
      >
        {icon}
        {displayText}
      </button>
      {popover && (
        <ReferencePopover payload={popover} onClose={() => setPopover(null)} />
      )}
    </span>
  );
}
