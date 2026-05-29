import { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import {
  COMPLIANCE_POSTURE_LABELS,
  MATURITY_POSTURE_LABELS,
  TRUST_POSTURE_LABELS,
} from '../../../../../lib/audit/labels';
import type {
  CompliancePosture,
  MaturityPosture,
  TrustPosture,
} from '../../../../../types/audit';

// =============================================================================
// TrustAssessmentForm
//
// Captures TrustAssessmentObject for an audit. Auditor records public-source
// vendor intelligence: certifications claimed, regulatory claims, postures,
// risk hypotheses, free-text notes.
//
// Note per spec: this is a structured capture layer for auditor judgment, not
// autonomous research. The system never fills these fields automatically in
// Phase 1.
// =============================================================================

export interface TrustAssessmentFormValues {
  certifications_claimed: string[];
  regulatory_claims: string[];
  compliance_posture: CompliancePosture;
  maturity_posture: MaturityPosture;
  provisional_trust_posture: TrustPosture;
  risk_hypotheses: string[];
  notes: string | null;
}

interface TrustAssessmentFormProps {
  initialValues?: Partial<TrustAssessmentFormValues>;
  onSubmit: (values: TrustAssessmentFormValues) => void;
  onCancel: () => void;
  submitting?: boolean;
}

const COMPLIANCE_OPTIONS: CompliancePosture[] = ['STRONG', 'ADEQUATE', 'WEAK', 'UNKNOWN'];
const MATURITY_OPTIONS: MaturityPosture[] = ['MATURE', 'DEVELOPING', 'EARLY', 'UNKNOWN'];
const TRUST_OPTIONS: TrustPosture[] = ['HIGH', 'MODERATE', 'LOW', 'UNKNOWN'];

export default function TrustAssessmentForm({
  initialValues,
  onSubmit,
  onCancel,
  submitting = false,
}: TrustAssessmentFormProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [certifications, setCertifications] = useState<string[]>(
    initialValues?.certifications_claimed ?? [],
  );
  const [regulatoryClaims, setRegulatoryClaims] = useState<string[]>(
    initialValues?.regulatory_claims ?? [],
  );
  const [compliance, setCompliance] = useState<CompliancePosture>(
    initialValues?.compliance_posture ?? 'UNKNOWN',
  );
  const [maturity, setMaturity] = useState<MaturityPosture>(
    initialValues?.maturity_posture ?? 'UNKNOWN',
  );
  const [trust, setTrust] = useState<TrustPosture>(
    initialValues?.provisional_trust_posture ?? 'UNKNOWN',
  );
  const [hypotheses, setHypotheses] = useState<string[]>(
    initialValues?.risk_hypotheses ?? [],
  );
  const [notes, setNotes] = useState<string>(initialValues?.notes ?? '');

  useEffect(() => {
    setCertifications(initialValues?.certifications_claimed ?? []);
    setRegulatoryClaims(initialValues?.regulatory_claims ?? []);
    setCompliance(initialValues?.compliance_posture ?? 'UNKNOWN');
    setMaturity(initialValues?.maturity_posture ?? 'UNKNOWN');
    setTrust(initialValues?.provisional_trust_posture ?? 'UNKNOWN');
    setHypotheses(initialValues?.risk_hypotheses ?? []);
    setNotes(initialValues?.notes ?? '');
  }, [initialValues]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      certifications_claimed: certifications,
      regulatory_claims: regulatoryClaims,
      compliance_posture: compliance,
      maturity_posture: maturity,
      provisional_trust_posture: trust,
      risk_hypotheses: hypotheses,
      notes: notes.trim() ? notes.trim() : null,
    });
  };

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const labelColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const inputBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const inputBorder = isLight
    ? 'border-[#CBD5E1] focus:border-[#02BBB8] focus:ring-1 focus:ring-[#02BBB8]/30'
    : 'border-white/15 focus:border-[#6FC9C7] focus:ring-1 focus:ring-[#6FC9C7]/30';
  const radioActive = isLight
    ? 'bg-[#02BBB8]/10 border-[#02BBB8] text-[#02BBB8]'
    : 'bg-[#02BBB8]/15 border-[#6FC9C7] text-[#6FC9C7]';
  const radioInactive = isLight
    ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:border-[#CBD5E1] hover:text-[#0F172A]'
    : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]/55 hover:border-white/20 hover:text-[#CBD5E1]';
  const buttonPrimary = isLight
    ? 'bg-[#02BBB8] text-white hover:bg-[#016663]'
    : 'bg-[#6FC9C7] text-[#0F172A] hover:bg-[#028E8B]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Certifications */}
      <ChipListField
        label="Certifications claimed"
        helper="ISO, HITRUST, SOC, etc."
        items={certifications}
        onChange={setCertifications}
        placeholder='e.g. "ISO 9001:2015"'
        isLight={isLight}
        labelColor={labelColor}
        subColor={subColor}
        inputBg={inputBg}
        inputBorder={inputBorder}
        headingColor={headingColor}
      />

      {/* Regulatory claims */}
      <ChipListField
        label="Regulatory claims"
        helper="Inspection history, registrations, conformance statements."
        items={regulatoryClaims}
        onChange={setRegulatoryClaims}
        placeholder='e.g. "21 CFR Part 11 conformance"'
        isLight={isLight}
        labelColor={labelColor}
        subColor={subColor}
        inputBg={inputBg}
        inputBorder={inputBorder}
        headingColor={headingColor}
      />

      {/* Postures */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PostureField
          label="Compliance posture"
          value={compliance}
          options={COMPLIANCE_OPTIONS}
          labels={COMPLIANCE_POSTURE_LABELS}
          onChange={setCompliance}
          radioActive={radioActive}
          radioInactive={radioInactive}
          labelColor={labelColor}
        />
        <PostureField
          label="Maturity posture"
          value={maturity}
          options={MATURITY_OPTIONS}
          labels={MATURITY_POSTURE_LABELS}
          onChange={setMaturity}
          radioActive={radioActive}
          radioInactive={radioInactive}
          labelColor={labelColor}
        />
        <PostureField
          label="Provisional trust posture"
          value={trust}
          options={TRUST_OPTIONS}
          labels={TRUST_POSTURE_LABELS}
          onChange={setTrust}
          radioActive={radioActive}
          radioInactive={radioInactive}
          labelColor={labelColor}
        />
      </div>

      {/* Risk hypotheses */}
      <ChipListField
        label="Risk hypotheses"
        helper="Auditor-authored statements about plausible risk areas to probe."
        items={hypotheses}
        onChange={setHypotheses}
        placeholder="One hypothesis per entry"
        isLight={isLight}
        labelColor={labelColor}
        subColor={subColor}
        inputBg={inputBg}
        inputBorder={inputBorder}
        headingColor={headingColor}
        multiline
      />

      {/* Notes */}
      <div>
        <label className={`block text-sm font-medium mb-1.5 ${labelColor}`}>
          Notes <span className="font-normal opacity-60">(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Free-form context. Structured fields are the source of truth."
          className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
        />
      </div>

      <div className={`flex items-center gap-2 pt-2 border-t ${isLight ? 'border-[#E2E8F0]' : 'border-white/5'}`}>
        <button
          type="submit"
          disabled={submitting}
          className={`text-sm font-semibold px-4 py-2 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
        >
          {submitting ? 'Saving…' : 'Save trust assessment'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className={`text-sm font-medium px-4 py-2 rounded-md transition-colors ${buttonSecondary}`}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface PostureFieldProps<T extends string> {
  label: string;
  value: T;
  options: T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
  radioActive: string;
  radioInactive: string;
  labelColor: string;
}

function PostureField<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
  radioActive,
  radioInactive,
  labelColor,
}: PostureFieldProps<T>) {
  return (
    <div>
      <label className={`block text-sm font-medium mb-2 ${labelColor}`}>{label}</label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => {
          const active = value === o;
          return (
            <button
              key={o}
              type="button"
              onClick={() => onChange(o)}
              className={`text-center rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${active ? radioActive : radioInactive}`}
            >
              {labels[o]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ChipListFieldProps {
  label: string;
  helper?: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  isLight: boolean;
  labelColor: string;
  subColor: string;
  inputBg: string;
  inputBorder: string;
  headingColor: string;
  multiline?: boolean;
}

function ChipListField({
  label,
  helper,
  items,
  onChange,
  placeholder,
  isLight,
  labelColor,
  subColor,
  inputBg,
  inputBorder,
  headingColor,
  multiline,
}: ChipListFieldProps) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter (without shift) commits in single-line mode; multiline lets shift+enter newline
    if (e.key === 'Enter' && !e.shiftKey && !multiline) {
      e.preventDefault();
      add();
    }
  };

  const remove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const chipBg = isLight
    ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#0F172A]'
    : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]';
  const chipRemoveBtn = isLight
    ? 'text-[#334155]/55 hover:text-red-600'
    : 'text-[#CBD5E1]/55 hover:text-red-400';
  const addButton = isLight
    ? 'bg-[#02BBB8] text-white hover:bg-[#016663]'
    : 'bg-[#6FC9C7] text-[#0F172A] hover:bg-[#028E8B]';

  return (
    <div>
      <label className={`block text-sm font-medium mb-1 ${labelColor}`}>{label}</label>
      {helper && <p className={`text-[11px] mb-2 ${subColor}`}>{helper}</p>}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {items.map((it, i) => (
            <span
              key={`${it}-${i}`}
              className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${chipBg}`}
            >
              <span className="leading-tight">{it}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove"
                className={`flex-shrink-0 ${chipRemoveBtn}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-start gap-2">
        {multiline ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder={placeholder}
            className={`flex-1 rounded-md border px-2.5 py-1.5 text-xs ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
          />
        ) : (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={`flex-1 rounded-md border px-2.5 py-1.5 text-xs ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
          />
        )}
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className={`flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${addButton} disabled:opacity-50`}
        >
          <Plus size={12} />
          Add
        </button>
      </div>
    </div>
  );
}
