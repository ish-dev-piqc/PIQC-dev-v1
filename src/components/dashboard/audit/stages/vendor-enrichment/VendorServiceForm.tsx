import { useState, useEffect } from 'react';
import { useTheme } from '../../../../../context/ThemeContext';
import { SERVICE_TYPE_OPTIONS } from '../../../../../lib/audit/labels';

// =============================================================================
// VendorServiceForm
//
// Captures the VendorServiceObject for an audit. One per audit; manual entry
// after contract review per UX spec ("Vendor service category should NOT be
// inferred automatically"). Once saved, the service is locked from this form
// — re-creating the service requires a new audit.
// =============================================================================

export interface VendorServiceFormValues {
  service_name: string;
  service_type: string;
  service_description: string | null;
}

interface VendorServiceFormProps {
  initialValues?: Partial<VendorServiceFormValues>;
  onSubmit: (values: VendorServiceFormValues) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export default function VendorServiceForm({
  initialValues,
  onSubmit,
  onCancel,
  submitting = false,
}: VendorServiceFormProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [name, setName] = useState(initialValues?.service_name ?? '');
  const [type, setType] = useState<string>(initialValues?.service_type ?? '');
  const [description, setDescription] = useState(initialValues?.service_description ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(initialValues?.service_name ?? '');
    setType(initialValues?.service_type ?? '');
    setDescription(initialValues?.service_description ?? '');
    setError(null);
  }, [initialValues]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Service name is required.');
    if (!type) return setError('Service type is required.');
    setError(null);
    onSubmit({
      service_name: name.trim(),
      service_type: type,
      service_description: description.trim() ? description.trim() : null,
    });
  };

  const headingColor = 'text-fg-heading';
  const labelColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const inputBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const inputBorder = isLight
    ? 'border-[#CBD5E1] focus:border-[#017BC8] focus:ring-1 focus:ring-[#017BC8]/30'
    : 'border-white/15 focus:border-[#74B4DC] focus:ring-1 focus:ring-[#74B4DC]/30';
  const radioActive = isLight
    ? 'bg-[#017BC8]/10 border-[#017BC8] text-[#017BC8]'
    : 'bg-[#017BC8]/15 border-[#74B4DC] text-[#74B4DC]';
  const radioInactive = isLight
    ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:border-[#CBD5E1] hover:text-[#0F172A]'
    : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]/55 hover:border-white/20 hover:text-[#CBD5E1]';
  const buttonPrimary = isLight
    ? 'bg-[#017BC8] text-white hover:bg-[#0477BF]'
    : 'bg-[#74B4DC] text-[#0F172A] hover:bg-[#026BBE]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className={`block text-sm font-medium mb-1.5 ${labelColor}`}>
          Service name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Central laboratory services for haematology and biomarkers"
          className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
        />
      </div>

      <div>
        <label className={`block text-sm font-medium mb-2 ${labelColor}`}>
          Service type
        </label>
        <p className={`${subColor} text-[11px] mb-2`}>
          Manual entry after contract review — pick the contracted service category.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SERVICE_TYPE_OPTIONS.map((opt) => {
            const active = type === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setType(opt.value)}
                className={`text-left rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${active ? radioActive : radioInactive}`}
                aria-pressed={active}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className={`block text-sm font-medium mb-1.5 ${labelColor}`}>
          Description
          <span className={`${subColor} font-normal ml-1`}>(optional)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Scope of services, geographies covered, key deliverables…"
          className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
        />
      </div>

      {error && (
        <p role="alert" className={`text-sm ${isLight ? 'text-red-600' : 'text-red-400'}`}>
          {error}
        </p>
      )}

      <div className={`flex items-center gap-2 pt-2 border-t ${isLight ? 'border-[#E2E8F0]' : 'border-white/5'}`}>
        <button
          type="submit"
          disabled={submitting}
          className={`text-sm font-semibold px-4 py-2 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
        >
          {submitting ? 'Saving…' : 'Save vendor service'}
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
