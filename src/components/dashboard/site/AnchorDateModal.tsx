import { useState } from 'react';
import { X, Calendar, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { setAnchorDate, materializeVisits } from '../../../lib/site/siteApi';

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
  onSaved: (result: { created: number; skipped_no_anchor: number }) => void;
  onClose: () => void;
}

export default function AnchorDateModal({
  protocolId,
  protocolCode,
  initialDate,
  onSaved,
  onClose,
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [date, setDate] = useState<string>(initialDate ?? new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!date) {
      setError('Pick a date.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const setResult = await setAnchorDate(protocolId, date);
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
    onSaved(matResult.data);
    onClose();
  };

  const bg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const border = isLight ? 'border-[#e2e8ee]' : 'border-white/5';
  const inputBg = isLight ? 'bg-white' : 'bg-[#0d1118]';
  const inputBorder = isLight
    ? 'border-[#cbd2db] focus:border-[#4a6fa5] focus:ring-1 focus:ring-[#4a6fa5]/30'
    : 'border-white/15 focus:border-[#6e8fb5] focus:ring-1 focus:ring-[#6e8fb5]/30';
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

          <p className={`${subColor} text-xs leading-relaxed`}>
            Each participant's visits are computed from <span className="font-mono">enrolled_at + study_day</span>.
            For participants without an enrolled_at yet, this anchor date is used as a fallback.
          </p>
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
              isLight ? 'bg-[#4a6fa5] hover:bg-[#3a5f95]' : 'bg-[#6e8fb5] hover:bg-[#7e9fc5]'
            }`}
          >
            {submitting ? 'Projecting visits…' : 'Set anchor & project'}
          </button>
        </div>
      </div>
    </div>
  );
}
