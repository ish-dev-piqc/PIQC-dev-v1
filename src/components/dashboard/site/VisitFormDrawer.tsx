import { useEffect, useRef, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import { useSiteData } from '../../../context/SiteDataContext';
import { createVisit } from '../../../lib/site/siteApi';

// =============================================================================
// VisitFormDrawer — manually schedule a single visit.
//
// For unscheduled visits (make-ups, ad-hoc assessments, first visits on a
// protocol before templates are extracted from a PDF). Inserts a row with
// template_id = NULL — outside the materialize_protocol_visits flow so it
// won't get wiped on re-projection.
// =============================================================================

interface VisitFormDrawerProps {
  protocolId: string;
  defaultParticipantUuid?: string; // pre-select if opened from a participant row
  onClose: () => void;
  // Fired once after a successful create so the parent can surface a brief
  // confirmation banner — the freshly-scheduled row is easy to lose among
  // hundreds of materialized visits.
  onSaved?: (summary: { visit_name: string; date: string }) => void;
}

export default function VisitFormDrawer({ protocolId, defaultParticipantUuid, onClose, onSaved }: VisitFormDrawerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const overlay = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });
  const { participants } = useSiteData();

  // Only participants on this protocol; exclude screen-failures (can't visit)
  // and withdrawn (out of study). UI affordance, not enforced server-side.
  const eligibleParticipants = participants.filter(
    (p) => p.protocol_id === protocolId && p.status !== 'SCREEN_FAILURE' && p.status !== 'WITHDRAWN',
  );

  const [participantUuid, setParticipantUuid] = useState(
    defaultParticipantUuid ?? eligibleParticipants[0]?.uuid ?? '',
  );
  // Default the date to today (YYYY-MM-DD in local TZ) so the most common
  // case — scheduling a visit for "soon" — needs minimal typing.
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('');
  const [visitName, setVisitName] = useState('');
  const [studyDay, setStudyDay] = useState('');
  const [proceduresText, setProceduresText] = useState('');
  const [priorNote, setPriorNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    dateRef.current?.focus();
  }, []);

  const validate = (): string | null => {
    if (!participantUuid) return 'Select a participant.';
    if (!date) return 'Visit date is required.';
    if (!visitName.trim()) return 'Visit name is required.';
    if (!/^-?\d+$/.test(studyDay.trim())) return 'Study day must be an integer.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    setError(null);

    const procedures = proceduresText
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const result = await createVisit({
      protocol_id: protocolId,
      participant_uuid: participantUuid,
      date,
      visit_name: visitName.trim(),
      study_day: parseInt(studyDay.trim(), 10),
      time_of_day: time.trim() || null,
      procedures,
      prior_note: priorNote.trim() || null,
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved?.({ visit_name: visitName.trim(), date });
    onClose();
  };

  const bg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const border = isLight ? 'border-[#e2e8ee]' : 'border-white/5';
  const inputBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#1a2230] border-white/10';
  const headingColor = 'text-fg-heading';
  const labelColor = 'text-fg-label';
  const subColor = 'text-fg-sub';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f] disabled:bg-[#4a6fa5]/50'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5] disabled:bg-[#6e8fb5]/50';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/5 text-[#d2d7e0] hover:bg-white/[0.04]';

  if (eligibleParticipants.length === 0) {
    // Guard: no eligible participants. Render an informational drawer rather
    // than a broken form. Coordinator needs to add a participant first.
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
          className={`w-full max-w-md h-full ${bg} border-l ${border} shadow-xl flex flex-col animate-slide-in-right`}
          {...swipe}
        >
          <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
            <h2 className={`${headingColor} font-semibold text-base`}>Schedule a visit</h2>
            <button type="button" onClick={onClose} className={`${subColor} hover:opacity-75`} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="p-5">
            <p className={`${subColor} text-sm leading-relaxed`}>
              This protocol has no eligible participants yet (active, screening, or completed). Add
              a participant first, then come back to schedule their visit.
            </p>
          </div>
        </div>
      </div>
    );
  }

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
        className={`w-full max-w-md h-full ${bg} border-l ${border} shadow-xl flex flex-col animate-slide-in-right`}
        {...swipe}
      >
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
            <h2 className={`${headingColor} font-semibold text-base`}>Schedule a visit</h2>
            <button type="button" onClick={onClose} className={`${subColor} hover:opacity-75`} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <p className={`${subColor} text-xs leading-relaxed`}>
              Schedule a one-off visit that's not tied to a parsed schedule-of-events template. The
              visit won't be touched if the protocol is later re-projected.
            </p>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Participant *
              </label>
              <select
                value={participantUuid}
                onChange={(e) => setParticipantUuid(e.target.value)}
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-[#4a6fa5]/30`}
                disabled={submitting}
              >
                {eligibleParticipants.map((p) => (
                  <option key={p.uuid} value={p.uuid}>
                    {p.id} {p.assigned_coordinator ? `· ${p.assigned_coordinator}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                  Date *
                </label>
                <input
                  ref={dateRef}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-[#4a6fa5]/30`}
                  disabled={submitting}
                />
              </div>
              <div>
                <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                  Time
                </label>
                <input
                  type="text"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  placeholder="e.g. 9:00 AM"
                  className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-[#4a6fa5]/30`}
                  disabled={submitting}
                />
              </div>
            </div>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Visit name *
              </label>
              <input
                type="text"
                value={visitName}
                onChange={(e) => setVisitName(e.target.value)}
                placeholder="e.g. Make-up Week 2 visit"
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-[#4a6fa5]/30`}
                disabled={submitting}
              />
            </div>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Study day *
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={studyDay}
                onChange={(e) => setStudyDay(e.target.value)}
                placeholder="e.g. 14 (or -7 for pre-baseline)"
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-[#4a6fa5]/30`}
                disabled={submitting}
              />
            </div>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Procedures
              </label>
              <input
                type="text"
                value={proceduresText}
                onChange={(e) => setProceduresText(e.target.value)}
                placeholder="Comma-separated, e.g. Vitals, AE check, Labs"
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-[#4a6fa5]/30`}
                disabled={submitting}
              />
            </div>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Prior note
              </label>
              <textarea
                value={priorNote}
                onChange={(e) => setPriorNote(e.target.value)}
                rows={3}
                placeholder="Optional context for whoever runs this visit."
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-[#4a6fa5]/30 resize-none`}
                disabled={submitting}
              />
            </div>

            {error && (
              <div
                className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs ${
                  isLight
                    ? 'bg-rose-50 border border-rose-200 text-rose-700'
                    : 'bg-rose-500/[0.06] border border-rose-500/20 text-rose-300'
                }`}
              >
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className={`flex items-center justify-end gap-2 px-5 py-3.5 border-t ${border}`}>
            <button type="button" onClick={onClose} disabled={submitting} className={`px-4 py-1.5 text-sm rounded-md transition-colors ${buttonSecondary} disabled:opacity-50`}>
              Cancel
            </button>
            <button type="submit" disabled={submitting} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${buttonPrimary}`}>
              {submitting ? 'Scheduling…' : 'Schedule visit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
