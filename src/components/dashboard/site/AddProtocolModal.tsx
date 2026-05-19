import { useEffect, useRef, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOverlay } from '../../../hooks/useOverlay';
import { useProtocol } from '../../../context/ProtocolContext';
import { createProtocol, type NewProtocolInput } from '../../../lib/site/siteApi';

// =============================================================================
// AddProtocolModal — minimal form for creating a new protocol manually.
//
// Path A in the onboarding flow (master plan §9.1). The PDF-upload path
// (Path B) is embedded in the Protocol tab; this modal is the always-available
// fallback when a user wants to add a protocol without (or before) ingesting
// the PDF.
//
// On submit, calls siteApi.createProtocol which stamps owner_id + owner_org.
// The new protocol is set as the active protocol so the user lands in it.
// =============================================================================

const PHASE_OPTIONS: Array<{ value: NewProtocolInput['clinical_trial_phase']; label: string }> = [
  { value: 'PHASE_1', label: 'Phase 1' },
  { value: 'PHASE_1_2', label: 'Phase 1/2' },
  { value: 'PHASE_2', label: 'Phase 2' },
  { value: 'PHASE_2_3', label: 'Phase 2/3' },
  { value: 'PHASE_3', label: 'Phase 3' },
  { value: 'PHASE_4', label: 'Phase 4' },
  { value: 'NOT_APPLICABLE', label: 'N/A' },
];

interface AddProtocolModalProps {
  onClose: () => void;
}

export default function AddProtocolModal({ onClose }: AddProtocolModalProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const overlay = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });
  const { setActiveProtocol } = useProtocol();

  const [studyNumber, setStudyNumber] = useState('');
  const [title, setTitle] = useState('');
  const [sponsor, setSponsor] = useState('');
  const [phase, setPhase] = useState<NewProtocolInput['clinical_trial_phase']>('PHASE_2');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const studyRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    studyRef.current?.focus();
  }, []);

  const validate = (): string | null => {
    if (!studyNumber.trim()) return 'Study number is required.';
    if (!/^[A-Za-z0-9-]+$/.test(studyNumber.trim())) {
      return 'Study number can only contain letters, numbers, and hyphens.';
    }
    if (!title.trim()) return 'Title is required.';
    if (!sponsor.trim()) return 'Sponsor is required.';
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
    const result = await createProtocol({
      study_number: studyNumber.trim(),
      title: title.trim(),
      sponsor: sponsor.trim(),
      clinical_trial_phase: phase,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setActiveProtocol(result.data);
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

  return (
    <div
      ref={overlay}
      onClick={(e) => {
        if (e.target === overlay.current) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 animate-fade-in"
    >
      <div
        ref={panelRef}
        className={`w-full max-w-md ${bg} border ${border} rounded-2xl shadow-xl animate-fade-in`}
      >
        <form onSubmit={handleSubmit}>
          <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
            <h2 className={`${headingColor} font-semibold text-base`}>Add protocol</h2>
            <button
              type="button"
              onClick={onClose}
              className={`${subColor} hover:opacity-75`}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <p className={`${subColor} text-xs leading-relaxed`}>
              Quick form for a manual protocol entry. To extract the schedule of events from a
              PDF automatically, use the PDF upload in the Protocol tab after the protocol is
              created.
            </p>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Study number *
              </label>
              <input
                ref={studyRef}
                type="text"
                value={studyNumber}
                onChange={(e) => setStudyNumber(e.target.value)}
                placeholder="e.g. NCT-12345 or STUDY-A"
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-[#4a6fa5]/30`}
                disabled={submitting}
                autoComplete="off"
              />
            </div>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. A phase 2 trial of investigational therapy in ..."
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-[#4a6fa5]/30`}
                disabled={submitting}
              />
            </div>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Sponsor *
              </label>
              <input
                type="text"
                value={sponsor}
                onChange={(e) => setSponsor(e.target.value)}
                placeholder="Sponsor name"
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-[#4a6fa5]/30`}
                disabled={submitting}
              />
            </div>

            <div>
              <label className={`block ${labelColor} text-xs font-semibold uppercase tracking-wider mb-1.5`}>
                Phase
              </label>
              <select
                value={phase}
                onChange={(e) => setPhase(e.target.value as NewProtocolInput['clinical_trial_phase'])}
                className={`w-full px-3 py-2 text-sm rounded-md border ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-[#4a6fa5]/30`}
                disabled={submitting}
              >
                {PHASE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${buttonSecondary} disabled:opacity-50`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${buttonPrimary}`}
            >
              {submitting ? 'Creating…' : 'Create protocol'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
