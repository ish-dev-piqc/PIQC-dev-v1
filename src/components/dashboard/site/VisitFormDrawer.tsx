import { useEffect, useMemo, useRef, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import { useProtocol } from '../../../context/ProtocolContext';
import { useSiteData } from '../../../context/SiteDataContext';
import { createVisit } from '../../../lib/site/siteApi';
import { fetchVisitTemplates } from '../../../lib/site/siteApi';

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
  const { activeProtocol } = useProtocol();

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
  const [selectedProcedures, setSelectedProcedures] = useState<Set<string>>(new Set());
  const [adhocProcedure, setAdhocProcedure] = useState('');
  const [priorNote, setPriorNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Procedure catalog — union of all procedures used by this protocol's
  // visit templates, deduped + sorted. Lets the user pick from the standard
  // set the protocol defines, with `adhocProcedure` for one-offs.
  const [procedureCatalog, setProcedureCatalog] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchVisitTemplates(protocolId).then((r) => {
      if (cancelled || !r.ok) return;
      const all = new Set<string>();
      for (const t of r.data) {
        for (const p of t.procedures ?? []) {
          if (typeof p === 'string' && p.trim()) all.add(p.trim());
        }
      }
      setProcedureCatalog([...all].sort((a, b) => a.localeCompare(b)));
    });
    return () => { cancelled = true; };
  }, [protocolId]);

  // study_day is derived, not user-typed. Prefer the selected participant's
  // enrolled_at as the day-0 reference (matches the materialize RPC's
  // COALESCE(enrolled_at, demo_anchor_date)); fall back to the protocol
  // anchor when enrolled_at is null. Compute relative to the local date the
  // user picked to avoid timezone drift.
  const computedStudyDay = useMemo(() => {
    const selected = eligibleParticipants.find((p) => p.uuid === participantUuid);
    const dayZero = selected?.enrolled_at ?? activeProtocol?.demoAnchorDate ?? null;
    if (!date || !dayZero) return null;
    const ms = new Date(date).getTime() - new Date(dayZero).getTime();
    if (!Number.isFinite(ms)) return null;
    return Math.round(ms / (1000 * 60 * 60 * 24));
  }, [date, participantUuid, eligibleParticipants, activeProtocol?.demoAnchorDate]);

  const dateRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    dateRef.current?.focus();
  }, []);

  const validate = (): string | null => {
    if (!participantUuid) return 'Select a participant.';
    if (!date) return 'Visit date is required.';
    if (!time) return 'Visit time is required.';
    if (!visitName.trim()) return 'Visit name is required.';
    if (computedStudyDay === null) {
      return 'Cannot compute study day — the selected participant has no enrolled_at and the protocol has no anchor date.';
    }
    return null;
  };

  // Convert the time input's "14:30" (24h) to the "2:30 PM" string the rest
  // of the app uses for display + sorting (parseTime in TodayTab).
  const format12h = (hhmm: string): string => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
    if (!m) return hhmm;
    let h = parseInt(m[1], 10);
    const mm = m[2];
    const period = h >= 12 ? 'PM' : 'AM';
    h = h % 12 === 0 ? 12 : h % 12;
    return `${h}:${mm} ${period}`;
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

    // Merge the checked catalog procedures with the optional ad-hoc additions.
    const adhoc = adhocProcedure
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const procedures = [...selectedProcedures, ...adhoc];

    const result = await createVisit({
      protocol_id: protocolId,
      participant_uuid: participantUuid,
      date,
      visit_name: visitName.trim(),
      study_day: computedStudyDay!,
      time_of_day: format12h(time),
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

  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';
  const headingColor = 'text-fg-heading';
  const labelColor = 'text-fg-label';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const buttonPrimary = isLight
    ? 'bg-[#017BC8] text-white hover:bg-[#0477BF] disabled:bg-[#017BC8]/50'
    : 'bg-[#74B4DC] text-[#0F172A] hover:bg-[#026BBE] disabled:bg-[#74B4DC]/50';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/5 text-[#CBD5E1] hover:bg-white/[0.04]';

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
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-[#017BC8]/30`}
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
                  className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-[#017BC8]/30`}
                  disabled={submitting}
                />
              </div>
              <div>
                <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                  Time *
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-[#017BC8]/30`}
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
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-[#017BC8]/30`}
                disabled={submitting}
              />
            </div>

            <div className={`text-xs ${subColor}`}>
              Study day:{' '}
              <span className={`${headingColor} font-mono font-semibold`}>
                {computedStudyDay !== null ? computedStudyDay : '—'}
              </span>{' '}
              <span className={mutedColor}>
                (derived from visit date minus participant's enrolled_at, or protocol anchor)
              </span>
            </div>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Procedures
              </label>
              {procedureCatalog.length === 0 ? (
                <p className={`text-xs ${mutedColor}`}>
                  No procedure catalog yet — add any procedures as ad-hoc entries below.
                </p>
              ) : (
                <div className={`max-h-48 overflow-y-auto px-3 py-2 rounded-md border ${inputBg}`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {procedureCatalog.map((proc) => {
                      const checked = selectedProcedures.has(proc);
                      return (
                        <label
                          key={proc}
                          className={`flex items-center gap-2 text-xs cursor-pointer ${headingColor}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={submitting}
                            onChange={(e) => {
                              setSelectedProcedures((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(proc);
                                else next.delete(proc);
                                return next;
                              });
                            }}
                            className="rounded"
                          />
                          <span className="truncate">{proc}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              <input
                type="text"
                value={adhocProcedure}
                onChange={(e) => setAdhocProcedure(e.target.value)}
                placeholder="Optional: comma-separated ad-hoc additions"
                className={`mt-2 w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-[#017BC8]/30`}
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
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-[#017BC8]/30 resize-none`}
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
