import { useEffect, useRef, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import { createParticipant, updateParticipant } from '../../../lib/site/siteApi';
import type { SiteParticipant, ParticipantStatus } from '../../../lib/site/types';
import { PARTICIPANT_STATUS_LABELS } from '../../../lib/site/labels';

// =============================================================================
// ParticipantFormDrawer — create or edit a site_participants row.
//
// mode='create': empty form. participant_code + status required. protocol_id
// passed in via props. On submit, calls siteApi.createParticipant.
//
// mode='edit':  pre-filled from `initial`. Same fields editable. On submit
// calls siteApi.updateParticipant. Realtime brings the change back to context.
// =============================================================================

const STATUS_OPTIONS: ParticipantStatus[] = [
  'SCREENING',
  'SCREEN_FAILURE',
  'ACTIVE',
  'COMPLETED',
  'WITHDRAWN',
];

interface FormState {
  participant_code: string;
  status: ParticipantStatus;
  enrolled_at: string;
  current_study_day: string;
  next_visit_date: string;
  next_visit_name: string;
  assigned_coordinator: string;
  open_deviations: string;
  notes: string;
}

const EMPTY: FormState = {
  participant_code: '',
  status: 'SCREENING',
  enrolled_at: '',
  current_study_day: '',
  next_visit_date: '',
  next_visit_name: '',
  assigned_coordinator: '',
  open_deviations: '0',
  notes: '',
};

function fromParticipant(p: SiteParticipant): FormState {
  return {
    participant_code: p.id,
    status: p.status,
    enrolled_at: p.enrolled_at ?? '',
    current_study_day: p.current_study_day != null ? String(p.current_study_day) : '',
    next_visit_date: p.next_visit_date ?? '',
    next_visit_name: p.next_visit_name ?? '',
    assigned_coordinator: p.assigned_coordinator ?? '',
    open_deviations: String(p.open_deviations ?? 0),
    notes: p.notes ?? '',
  };
}

interface Props {
  mode: 'create' | 'edit';
  protocolId: string;
  protocolCode: string;
  initial?: SiteParticipant;
  onSaved: (saved: SiteParticipant) => void;
  onClose: () => void;
}

export default function ParticipantFormDrawer({
  mode,
  protocolId,
  protocolCode,
  initial,
  onSaved,
  onClose,
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });

  const [form, setForm] = useState<FormState>(
    mode === 'edit' && initial ? fromParticipant(initial) : EMPTY,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'edit' && initial) setForm(fromParticipant(initial));
  }, [mode, initial]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((s) => ({ ...s, [k]: v }));
  };

  const validate = (): string | null => {
    if (!form.participant_code.trim()) return 'Participant code is required.';
    if (!/^[A-Za-z0-9-]+$/.test(form.participant_code.trim()))
      return 'Participant code must contain only letters, numbers, or "-".';
    // enrolled_at is required on create so the participant's day-0 reference
    // is well-defined for visit projection (materialize_protocol_visits uses
    // COALESCE(enrolled_at, demo_anchor_date)). Edits keep the legacy null
    // path for now to avoid blocking saves on historical rows.
    if (mode === 'create' && !form.enrolled_at) {
      return 'Enrolled date is required so the visit schedule projects correctly.';
    }
    if (form.current_study_day && Number.isNaN(Number(form.current_study_day)))
      return 'Current study day must be a number.';
    if (Number(form.open_deviations) < 0) return 'Open deviations cannot be negative.';
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSubmitting(true);

    const common = {
      status: form.status,
      enrolled_at: form.enrolled_at || null,
      current_study_day: form.current_study_day ? Number(form.current_study_day) : null,
      next_visit_date: form.next_visit_date || null,
      next_visit_name: form.next_visit_name.trim() || null,
      assigned_coordinator: form.assigned_coordinator.trim() || null,
      open_deviations: Number(form.open_deviations) || 0,
      notes: form.notes.trim() || null,
    };

    const result = mode === 'create'
      ? await createParticipant({
          ...common,
          participant_code: form.participant_code.trim(),
          protocol_id: protocolId,
        })
      : await updateParticipant(initial!.uuid, common);

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(result.data);
    onClose();
  };

  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const inputBg = isLight ? 'bg-white' : 'bg-[#020617]';
  const inputBorder = isLight
    ? 'border-[#CBD5E1] focus:border-[#017BC8] focus:ring-1 focus:ring-[#017BC8]/30'
    : 'border-white/15 focus:border-[#74B4DC] focus:ring-1 focus:ring-[#74B4DC]/30';
  const labelColor = 'text-fg-label';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      className="fixed inset-0 z-[70] bg-black/30 flex justify-end animate-fade-in"
    >
      <div
        ref={panelRef}
        className={`w-full max-w-md h-full ${bg} border-l ${border} shadow-xl flex flex-col animate-slide-in-right`}
        {...swipe}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
          <div>
            <p className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
              {protocolCode}
            </p>
            <h3 className={`${headingColor} text-base font-semibold mt-0.5`}>
              {mode === 'create' ? 'Add participant' : `Edit ${initial?.id ?? 'participant'}`}
            </h3>
          </div>
          <button type="button" onClick={onClose} className={`${subColor} hover:opacity-75`} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div
              className={`flex items-start gap-2 border rounded-md px-3 py-2 text-xs ${
                isLight ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-rose-500/[0.06] border-rose-500/20 text-rose-300'
              }`}
            >
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <Field label="Participant code" required labelColor={labelColor}>
            <input
              type="text"
              value={form.participant_code}
              onChange={(e) => update('participant_code', e.target.value)}
              placeholder="P-0023"
              disabled={mode === 'edit'}
              className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} disabled:opacity-60 focus:outline-none transition-colors`}
            />
            {mode === 'edit' && (
              <p className={`${mutedColor} text-[11px] mt-1`}>
                Code is immutable after creation. Delete + recreate if needed.
              </p>
            )}
          </Field>

          <Field label="Status" required labelColor={labelColor}>
            <select
              value={form.status}
              onChange={(e) => update('status', e.target.value as ParticipantStatus)}
              className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {PARTICIPANT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label={mode === 'create' ? 'Enrolled date *' : 'Enrolled date'}
              labelColor={labelColor}
            >
              <input
                type="date"
                value={form.enrolled_at}
                onChange={(e) => update('enrolled_at', e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
              />
            </Field>
            <Field label="Study day" labelColor={labelColor}>
              <input
                type="number"
                value={form.current_study_day}
                onChange={(e) => update('current_study_day', e.target.value)}
                placeholder="0"
                className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Next visit date" labelColor={labelColor}>
              <input
                type="date"
                value={form.next_visit_date}
                onChange={(e) => update('next_visit_date', e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
              />
            </Field>
            <Field label="Next visit name" labelColor={labelColor}>
              <input
                type="text"
                value={form.next_visit_name}
                onChange={(e) => update('next_visit_name', e.target.value)}
                placeholder="Week 2 visit"
                className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
              />
            </Field>
          </div>

          <Field label="Assigned coordinator" labelColor={labelColor}>
            <input
              type="text"
              value={form.assigned_coordinator}
              onChange={(e) => update('assigned_coordinator', e.target.value)}
              placeholder="Sarah Chen"
              className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
            />
          </Field>

          <Field label="Open deviations" labelColor={labelColor}>
            <input
              type="number"
              min={0}
              value={form.open_deviations}
              onChange={(e) => update('open_deviations', e.target.value)}
              className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
            />
          </Field>

          <Field label="Notes" labelColor={labelColor}>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Optional context — outreach attempts, follow-ups, etc."
              className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors resize-none`}
            />
          </Field>
        </form>

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
            onClick={(e) => submit(e as unknown as React.FormEvent)}
            disabled={submitting}
            className={`text-xs font-semibold px-4 py-1.5 rounded-md text-white transition-colors disabled:opacity-50 ${
              isLight ? 'bg-[#017BC8] hover:bg-[#0477BF]' : 'bg-[#74B4DC] hover:bg-[#3CACF4]'
            }`}
          >
            {submitting ? 'Saving…' : mode === 'create' ? 'Create participant' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
  labelColor,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  labelColor: string;
}) {
  return (
    <label className="block">
      <span className={`${labelColor} text-[11px] uppercase tracking-wider font-semibold block mb-1.5`}>
        {label}
        {required && <span className="text-rose-500 ml-1">*</span>}
      </span>
      {children}
    </label>
  );
}
