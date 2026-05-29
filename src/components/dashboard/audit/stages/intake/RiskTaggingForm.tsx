import { useState, useEffect } from 'react';
import { FileSearch, Link2, X as XIcon } from 'lucide-react';
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
import type { ExtractedItemRecord } from '../../../../../types/sotr';
import SourceTruthListDrawer from '../../../../sotr/SourceTruthListDrawer';
import SourceTruthDrawer from '../../../../sotr/SourceTruthDrawer';
import { formatExtractedValue } from '../../../../sotr/WorksheetItemRow';

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
  /** SOTR protocol_extracted_item this risk traces back to (optional). */
  source_extracted_item_id: string | null;
}

interface RiskTaggingFormProps {
  mode: 'add' | 'edit';
  initialValues?: Partial<RiskTagFormValues>;
  onSubmit: (values: RiskTagFormValues) => void;
  onCancel: () => void;
  submitting?: boolean;
  /** Protocol UUID — feeds the SOTR drawer (studyId in SOTR's API).
   *  When null/missing, the source-link picker is hidden. */
  protocolId?: string | null;
  /** Optional human-friendly protocol code (e.g. "BRIGHTEN-2") for the
   *  SOTR drawer's export filename. */
  protocolCode?: string | null;
}

const TIERS: EndpointTier[] = ['PRIMARY', 'SECONDARY', 'SAFETY', 'SUPPORTIVE'];
const SURFACES: ImpactSurface[] = ['DATA_INTEGRITY', 'PATIENT_SAFETY', 'BOTH'];

export default function RiskTaggingForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  submitting = false,
  protocolId,
  protocolCode,
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
  // Source-link state. The id is what gets persisted; the label is a fresh
  // snapshot from the picker drawer so the inline chip can render meaningfully
  // without a second fetch. On edit-load we only have the id, so the chip
  // renders "Linked source" + a View button until the auditor reopens it.
  const [sourceItemId, setSourceItemId] = useState<string | null>(
    initialValues?.source_extracted_item_id ?? null,
  );
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewSourceOpen, setViewSourceOpen] = useState(false);
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
    setSourceItemId(initialValues?.source_extracted_item_id ?? null);
    setSourceLabel(null);
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
      source_extracted_item_id: sourceItemId,
    });
  };

  const handlePickSource = (item: ExtractedItemRecord) => {
    setSourceItemId(item.id);
    // Snapshot the display label for the chip — drops to "Linked source" if the
    // value is unrenderable, which is fine; the View button is the real verifier.
    setSourceLabel(item.current_text ?? formatExtractedValue(item.extracted_value));
    setPickerOpen(false);
  };

  const handleClearSource = () => {
    setSourceItemId(null);
    setSourceLabel(null);
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
    ? 'border-[#CBD5E1] focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
    : 'border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30';
  const inputBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const radioActiveLight = 'bg-brand-600/10 border-brand-600 text-brand-600';
  const radioActiveDark = 'bg-brand-600/15 border-brand-300 text-brand-300';
  const radioInactive = isLight
    ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:border-[#CBD5E1] hover:text-[#0F172A]'
    : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]/55 hover:border-white/20 hover:text-[#CBD5E1]';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';

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

      {/* Protocol source link (optional). Hidden when no protocol is on the
          active audit — the picker would have nothing to read from. */}
      {protocolId && (
        <div>
          <label className={`block text-sm font-medium mb-1 ${labelColor}`}>
            Protocol source <span className={`${mutedColor} font-normal`}>(optional)</span>
          </label>
          <p className={`text-[11px] mb-2 ${subColor}`}>
            Trace this risk back to the parsed protocol item it came from. The auditor
            can inspect a candidate item before attaching.
          </p>
          {sourceItemId ? (
            <div
              className={`flex items-center gap-2 flex-wrap rounded-md border px-3 py-2 ${inputBg} ${
                isLight ? 'border-[#CBD5E1]' : 'border-white/15'
              }`}
            >
              <Link2 size={12} className={mutedColor} />
              <span className={`${headingColor} text-sm flex-1 min-w-0 truncate`}>
                {sourceLabel ?? 'Linked source'}
              </span>
              <button
                type="button"
                onClick={() => setViewSourceOpen(true)}
                className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${buttonSecondary}`}
              >
                <FileSearch size={11} />
                View
              </button>
              <button
                type="button"
                onClick={handleClearSource}
                aria-label="Remove protocol source link"
                className={`inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors ${buttonSecondary}`}
              >
                <XIcon size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className={`w-full text-left rounded-md border border-dashed px-3 py-2.5 text-sm transition-colors flex items-center gap-2 ${
                isLight
                  ? 'border-[#CBD5E1] hover:border-brand-600/40 hover:bg-[#F8FAFC] text-[#334155]/75'
                  : 'border-white/15 hover:border-brand-300/40 hover:bg-white/[0.03] text-[#CBD5E1]/70'
              }`}
            >
              <FileSearch size={13} className={mutedColor} />
              Choose a protocol source item…
            </button>
          )}
        </div>
      )}

      {/* Picker drawer — opens in pick-mode (Attach button on each row). */}
      {pickerOpen && protocolId && (
        <SourceTruthListDrawer
          studyId={protocolId}
          studyCode={protocolCode ?? null}
          onClose={() => setPickerOpen(false)}
          onPick={handlePickSource}
        />
      )}

      {/* View drawer — opens the per-item SOTR drawer for the currently linked
          source. Stacks at z-50 over the form. */}
      {viewSourceOpen && sourceItemId && protocolId && (
        <SourceTruthDrawer
          studyId={protocolId}
          worksheetItemId={sourceItemId}
          itemLabel={sourceLabel ?? 'Linked source'}
          onClose={() => setViewSourceOpen(false)}
        />
      )}

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
      <div className={`flex items-center gap-2 pt-2 border-t ${isLight ? 'border-[#E2E8F0]' : 'border-white/5'}`}>
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
