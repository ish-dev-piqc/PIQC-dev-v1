import { useState } from 'react';
import { X, Calendar, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { setAnchorDate, materializeVisits } from '../../../lib/site/siteApi';
import { TIMEZONE_OPTIONS } from '../../../lib/timezones';

// =============================================================================
// AnchorDateModal — collects the calendar date for protocol Day 0.
//
// Reducto extracts study-day offsets ("Day 14") from the PDF but no calendar
// dates. This modal asks: "When does Day 0 land on the calendar for this
// protocol?" — saving the answer to protocols.demo_anchor_date and triggering
// materialize_protocol_visits so visits appear immediately.
// =============================================================================

interface Props {
  protocolId: string;
  protocolCode: string;
  initialDate: string | null;
  initialTimezone: string | null;
  onSaved: (result: { created: number; skipped_no_anchor: number }) => void;
  onClose: () => void;
}

// Curated IANA zone list lives in src/lib/timezones.ts — shared with the
// Account settings drawer so both pickers stay in sync.

export default function AnchorDateModal({
  protocolId,
  protocolCode,
  initialDate,
  initialTimezone,
  onSaved,
  onClose,
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [date, setDate] = useState<string>(initialDate ?? new Date().toISOString().slice(0, 10));
  const [timezone, setTimezone] = useState<string>(initialTimezone ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!date) {
      setError('Pick a date.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const setResult = await setAnchorDate(protocolId, date, timezone || null);
    if (!setResult.ok) {
      setError(setResult.error);
      setSubmitting(false);
      return;
    }
    const matResult = await materializeVisits(protocolId);
    setSubmitting(false);
    if (!matResult.ok) {
      setError(matResult.error);
      return;
    }
    // materializeVisits cross-products participants × templates. With zero
    // participants we save the anchor but project nothing onto the calendar
    // — surface that explicitly so the user knows the next step.
    if (matResult.data.created === 0) {
      setError(
        'Anchor date saved. Add a participant on the Participants tab to project visits onto the calendar.',
      );
      return;
    }
    onSaved(matResult.data);
    onClose();
  };

  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const inputBg = isLight ? 'bg-white' : 'bg-[#020617]';
  const inputBorder = isLight
    ? 'border-[#CBD5E1] focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
    : 'border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30';
  const labelColor = 'text-fg-label';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center px-4 animate-fade-in"
    >
      <div className={`w-full max-w-md ${bg} border ${border} rounded-xl shadow-xl flex flex-col`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
          <div className="flex items-center gap-2.5">
            <Calendar size={16} className="text-fg-muted" />
            <div>
              <p className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
                {protocolCode}
              </p>
              <h3 className={`${headingColor} text-base font-semibold mt-0.5`}>
                Set protocol anchor date
              </h3>
            </div>
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

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          <p className={`${subColor} text-sm leading-relaxed`}>
            The protocol PDF specifies visits as study-day offsets (Day 1, Day 14, etc.). Pick the
            calendar date for <span className="font-mono font-semibold">Day 0</span> — typically
            the first-dose date — and we'll project all visits onto the calendar.
          </p>

          {error && (
            <div
              className={`flex items-start gap-2 border rounded-md px-3 py-2 text-xs ${
                isLight
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'bg-rose-500/[0.06] border-rose-500/20 text-rose-300'
              }`}
            >
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <label className="block">
            <span className={`${labelColor} text-[11px] uppercase tracking-wider font-semibold block mb-1.5`}>
              Day 0 calendar date
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
            />
          </label>

          <label className="block">
            <span className={`${labelColor} text-[11px] uppercase tracking-wider font-semibold block mb-1.5`}>
              Protocol timezone
            </span>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value || 'browser'} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            <span className={`${subColor} text-xs mt-1 block`}>
              Defines the wall-clock interpretation for visit dates and times — pick the site's local zone so coordinators see consistent times across machines.
            </span>
          </label>

          <div
            className={`text-xs leading-relaxed border rounded-md px-3 py-2 ${
              isLight ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-amber-500/[0.06] border-amber-500/20 text-amber-300'
            }`}
          >
            <p className="font-semibold mb-1">How the anchor is used</p>
            <p>
              Each participant's visits are computed from
              {' '}<span className="font-mono">enrolled_at + study_day</span>. This anchor is
              only the fallback for participants <strong>without</strong> an
              {' '}<span className="font-mono">enrolled_at</span> set. Participants who already have
              an enrolled date keep using <em>their</em> date — changing this anchor won't shift
              their schedule. To shift those participants too, edit their enrolled date on the
              Participants tab.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-end gap-2 px-5 py-3 border-t ${border}`}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={`text-xs font-medium px-3 py-1.5 rounded-md ${subColor} hover:opacity-75 disabled:opacity-50`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={`text-xs font-semibold px-4 py-1.5 rounded-md text-white transition-colors disabled:opacity-50 ${
              isLight ? 'bg-brand-600 hover:bg-brand-800' : 'bg-brand-300 hover:bg-brand-400'
            }`}
          >
            {submitting ? 'Projecting visits…' : 'Set anchor & project'}
          </button>
        </div>
      </div>
    </div>
  );
}
