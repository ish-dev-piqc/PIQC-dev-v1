import { useState, useEffect } from 'react';
import { useTheme } from '../../../../../context/ThemeContext';
import {
  ENDPOINT_TIER_LABELS,
  ENDPOINT_TIER_DESCRIPTIONS,
  IMPACT_SURFACE_LABELS,
  OPERATIONAL_DOMAIN_OPTIONS,
  VENDOR_DEPENDENCY_FLAG_OPTIONS,
} from '../../../../../lib/audit/labels';
import type {
  EndpointTier,
  ImpactSurface,
} from '../../../../../types/audit';

// =============================================================================
// RiskTaggingForm
//
// Phase 1 manual mode (Phase 2/3 add suggestion-aware props — same form shape).
// The form captures the five risk attributes that anchor downstream criticality
// scoring, questionnaire addenda, and the risk summary:
//   - endpoint tier
//   - impact surface
//   - time sensitivity
//   - vendor dependency flags (multi)
//   - operational domain tag
//
// Plus the section identifier and section title (free-text in Phase 1; will be
// pre-populated from PIQC payload in Phase 2). identifier and title are
// immutable once a section has been tagged — preserves traceability.
// =============================================================================

export interface RiskTagFormValues {
  section_identifier: string;
  section_title: string;
  endpoint_tier: EndpointTier;
  impact_surface: ImpactSurface;
  time_sensitivity: boolean;
  vendor_dependency_flags: string[];
  operational_domain_tag: string;
}

interface RiskTaggingFormProps {
  mode: 'add' | 'edit';
  initialValues?: Partial<RiskTagFormValues>;
  onSubmit: (values: RiskTagFormValues) => void;
  onCancel: () => void;
  submitting?: boolean;
}

const TIERS: EndpointTier[] = ['PRIMARY', 'SECONDARY', 'SAFETY', 'SUPPORTIVE'];
const SURFACES: ImpactSurface[] = ['DATA_INTEGRITY', 'PATIENT_SAFETY', 'BOTH'];

export default function RiskTaggingForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  submitting = false,
}: RiskTaggingFormProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  // ---------------------------------------------------------------------------
  // Form state
  // ---------------------------------------------------------------------------
  const [identifier, setIdentifier] = useState(initialValues?.section_identifier ?? '');
  const [title, setTitle] = useState(initialValues?.section_title ?? '');
  const [tier, setTier] = useState<EndpointTier>(initialValues?.endpoint_tier ?? 'PRIMARY');
  const [surface, setSurface] = useState<ImpactSurface>(
    initialValues?.impact_surface ?? 'DATA_INTEGRITY',
  );
  const [timeSensitive, setTimeSensitive] = useState<boolean>(
    initialValues?.time_sensitivity ?? false,
  );
  const [flags, setFlags] = useState<string[]>(
    initialValues?.vendor_dependency_flags ?? [],
  );
  const [domain, setDomain] = useState<string>(
    initialValues?.operational_domain_tag ?? '',
  );
  const [error, setError] = useState<string | null>(null);

  // Reset when initialValues changes (switching from add to edit a different row)
  useEffect(() => {
    setIdentifier(initialValues?.section_identifier ?? '');
    setTitle(initialValues?.section_title ?? '');
    setTier(initialValues?.endpoint_tier ?? 'PRIMARY');
    setSurface(initialValues?.impact_surface ?? 'DATA_INTEGRITY');
    setTimeSensitive(initialValues?.time_sensitivity ?? false);
    setFlags(initialValues?.vendor_dependency_flags ?? []);
    setDomain(initialValues?.operational_domain_tag ?? '');
    setError(null);
  }, [initialValues]);

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) {
      setError('Section identifier is required.');
      return;
    }
    if (!title.trim()) {
      setError('Section title is required.');
      return;
    }
    if (!domain) {
      setError('Operational domain is required.');
      return;
    }
    setError(null);
    onSubmit({
      section_identifier: identifier.trim(),
      section_title: title.trim(),
      endpoint_tier: tier,
      impact_surface: surface,
      time_sensitivity: timeSensitive,
      vendor_dependency_flags: flags,
      operational_domain_tag: domain,
    });
  };

  const toggleFlag = (value: string) => {
    setFlags((prev) =>
      prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value],
    );
  };

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const labelColor = 'text-fg-heading';
  const inputBorder = isLight
    ? 'border-[#cbd2db] focus:border-[#4a6fa5] focus:ring-1 focus:ring-[#4a6fa5]/30'
    : 'border-white/15 focus:border-[#6e8fb5] focus:ring-1 focus:ring-[#6e8fb5]/30';
  const inputBg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const radioActiveLight = 'bg-[#4a6fa5]/10 border-[#4a6fa5] text-[#4a6fa5]';
  const radioActiveDark = 'bg-[#4a6fa5]/15 border-[#6e8fb5] text-[#6e8fb5]';
  const radioInactive = isLight
    ? 'bg-white border-[#e2e8ee] text-[#374152]/65 hover:border-[#cbd2db] hover:text-[#1a1f28]'
    : 'bg-[#131a22] border-white/10 text-[#d2d7e0]/55 hover:border-white/20 hover:text-[#d2d7e0]';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';

  const isEdit = mode === 'edit';
  const radioActive = isLight ? radioActiveLight : radioActiveDark;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Section identifier + title */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr,2fr] gap-4">
        <div>
          <label className={`block text-sm font-medium mb-1.5 ${labelColor}`}>
            Section identifier
          </label>
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="e.g. 5.3.2 or §7.1"
            disabled={isEdit}
            className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors disabled:opacity-60`}
          />
          {isEdit && (
            <p className={`text-[11px] mt-1 ${mutedColor}`}>
              Identifier is locked after tagging.
            </p>
          )}
        </div>
        <div>
          <label className={`block text-sm font-medium mb-1.5 ${labelColor}`}>
            Section title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Central Laboratory Services"
            disabled={isEdit}
            className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors disabled:opacity-60`}
          />
        </div>
      </div>

      {/* Endpoint tier */}
      <div>
        <label className={`block text-sm font-medium mb-2 ${labelColor}`}>
          Endpoint tier
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TIERS.map((t) => {
            const active = tier === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={`text-left rounded-md border px-3 py-2 transition-colors ${active ? radioActive : radioInactive}`}
                aria-pressed={active}
              >
                <div className="text-xs font-semibold">{ENDPOINT_TIER_LABELS[t]}</div>
                <div className={`text-[11px] mt-0.5 leading-snug ${active ? '' : mutedColor}`}>
                  {ENDPOINT_TIER_DESCRIPTIONS[t]}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Impact surface + time sensitivity */}
      <div className="grid grid-cols-1 md:grid-cols-[2fr,1fr] gap-6">
        <div>
          <label className={`block text-sm font-medium mb-2 ${labelColor}`}>
            Impact surface
          </label>
          <div className="grid grid-cols-3 gap-2">
            {SURFACES.map((s) => {
              const active = surface === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSurface(s)}
                  className={`text-center rounded-md border px-2 py-2 text-xs font-semibold transition-colors ${active ? radioActive : radioInactive}`}
                  aria-pressed={active}
                >
                  {IMPACT_SURFACE_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className={`block text-sm font-medium mb-2 ${labelColor}`}>
            Time-sensitive
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTimeSensitive(false)}
              className={`text-center rounded-md border px-2 py-2 text-xs font-semibold transition-colors ${!timeSensitive ? radioActive : radioInactive}`}
              aria-pressed={!timeSensitive}
            >
              No
            </button>
            <button
              type="button"
              onClick={() => setTimeSensitive(true)}
              className={`text-center rounded-md border px-2 py-2 text-xs font-semibold transition-colors ${timeSensitive ? radioActive : radioInactive}`}
              aria-pressed={timeSensitive}
            >
              Yes
            </button>
          </div>
        </div>
      </div>

      {/* Operational domain (single-select) */}
      <div>
        <label className={`block text-sm font-medium mb-2 ${labelColor}`}>
          Operational domain
          <span className={`${mutedColor} font-normal ml-1`}>(primary domain this section addresses)</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {OPERATIONAL_DOMAIN_OPTIONS.map((opt) => {
            const active = domain === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDomain(opt.value)}
                className={`text-left rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${active ? radioActive : radioInactive}`}
                aria-pressed={active}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Vendor dependency flags (multi) */}
      <div>
        <label className={`block text-sm font-medium mb-1 ${labelColor}`}>
          Vendor dependency flags
        </label>
        <p className={`text-[11px] mb-2 ${subColor}`}>
          Tick every vendor category this section depends on. A section can flag multiple
          (e.g. central lab + ECG).
        </p>
        <div className="flex flex-wrap gap-2">
          {VENDOR_DEPENDENCY_FLAG_OPTIONS.map((opt) => {
            const active = flags.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleFlag(opt.value)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? radioActive : radioInactive}`}
                aria-pressed={active}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {flags.length > 0 && (
          <p className={`text-[11px] mt-2 ${sectionHeader}`}>
            {flags.length} flag{flags.length === 1 ? '' : 's'} selected
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <p
          role="alert"
          className={`text-sm ${isLight ? 'text-red-600' : 'text-red-400'}`}
        >
          {error}
        </p>
      )}

      {/* Actions */}
      <div className={`flex items-center gap-2 pt-2 border-t ${isLight ? 'border-[#e2e8ee]' : 'border-white/5'}`}>
        <button
          type="submit"
          disabled={submitting}
          className={`text-sm font-semibold px-4 py-2 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
        >
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Tag section'}
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
