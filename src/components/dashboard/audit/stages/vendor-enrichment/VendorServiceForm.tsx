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

  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const labelColor = isLight ? 'text-[#1a1f28]' : 'text-[#d2d7e0]';
  const subColor = isLight ? 'text-[#374152]/65' : 'text-[#d2d7e0]/55';
  const inputBg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const inputBorder = isLight
    ? 'border-[#cbd2db] focus:border-[#4a6fa5] focus:ring-1 focus:ring-[#4a6fa5]/30'
    : 'border-white/15 focus:border-[#6e8fb5] focus:ring-1 focus:ring-[#6e8fb5]/30';
  const radioActive = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5] text-[#4a6fa5]'
    : 'bg-[#4a6fa5]/15 border-[#6e8fb5] text-[#6e8fb5]';
  const radioInactive = isLight
    ? 'bg-white border-[#e2e8ee] text-[#374152]/65 hover:border-[#cbd2db] hover:text-[#1a1f28]'
    : 'bg-[#131a22] border-white/10 text-[#d2d7e0]/55 hover:border-white/20 hover:text-[#d2d7e0]';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';

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

      <div className={`flex items-center gap-2 pt-2 border-t ${isLight ? 'border-[#e2e8ee]' : 'border-white/5'}`}>
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
