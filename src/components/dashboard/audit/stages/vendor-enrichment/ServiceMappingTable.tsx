import { useState } from 'react';
import { Plus, Pencil, X } from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import {
  DERIVED_CRITICALITY_LABELS,
  ENDPOINT_TIER_LABELS,
} from '../../../../../lib/audit/labels';
import type { TaggedSection } from '../../../../../lib/audit/mockProtocolRisks';
import type { MockServiceMapping } from '../../../../../lib/audit/mockVendorEnrichment';
import type { DerivedCriticality } from '../../../../../types/audit';

// =============================================================================
// ServiceMappingTable
//
// Shows VendorServiceMappingObject rows linking the vendor service to each
// protocol risk it's responsible for. Each mapping carries a derived
// criticality + rationale that the auditor can edit.
//
// Phase 1 Phase B: criticality is auditor-assigned (no automatic derivation).
// Phase 2 layers a deterministic derivation rule on top — UI stays the same.
// =============================================================================

interface ServiceMappingTableProps {
  mappings: MockServiceMapping[];
  availableRisks: TaggedSection[];           // all protocol risks for this audit
  vendorServiceId: string;
  onAdd: (mapping: Omit<MockServiceMapping, 'id'>) => void;
  onUpdate: (mappingId: string, updates: Partial<MockServiceMapping>) => void;
  onRemove: (mappingId: string) => void;
}

const CRITICALITY_OPTIONS: DerivedCriticality[] = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'];

export default function ServiceMappingTable({
  mappings,
  availableRisks,
  vendorServiceId,
  onAdd,
  onUpdate,
  onRemove,
}: ServiceMappingTableProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const mappedRiskIds = new Set(mappings.map((m) => m.protocol_risk_id));
  const unmappedRisks = availableRisks.filter((r) => !mappedRiskIds.has(r.id));

  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/65' : 'text-[#d2d7e0]/55';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const emptyBg = isLight
    ? 'border-[#e2e8ee] bg-[#f9fafc]/40'
    : 'border-white/5 bg-white/[0.01]';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';

  return (
    <div className="space-y-3">
      {/* Existing mappings */}
      {mappings.length === 0 && !adding && (
        <div className={`border border-dashed rounded-lg px-4 py-6 text-center ${emptyBg}`}>
          <p className={`${subColor} text-sm`}>
            No protocol sections mapped yet. Map the sections this vendor is responsible for to anchor downstream addenda and the risk summary.
          </p>
        </div>
      )}

      {mappings.map((m) => {
        const risk = availableRisks.find((r) => r.id === m.protocol_risk_id);
        if (editingId === m.id) {
          return (
            <MappingRow
              key={m.id}
              mode="edit"
              mapping={m}
              risk={risk}
              isLight={isLight}
              cardBg={cardBg}
              onSave={(updates) => {
                onUpdate(m.id, updates);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
              onRemove={() => {
                onRemove(m.id);
                setEditingId(null);
              }}
            />
          );
        }
        return (
          <MappingRow
            key={m.id}
            mode="view"
            mapping={m}
            risk={risk}
            isLight={isLight}
            cardBg={cardBg}
            onEdit={() => setEditingId(m.id)}
          />
        );
      })}

      {/* Add new mapping */}
      {adding && (
        <AddMappingForm
          vendorServiceId={vendorServiceId}
          unmappedRisks={unmappedRisks}
          isLight={isLight}
          cardBg={cardBg}
          onSubmit={(payload) => {
            onAdd(payload);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {!adding && unmappedRisks.length > 0 && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md transition-colors ${buttonPrimary}`}
        >
          <Plus size={14} />
          Map another section
        </button>
      )}

      {!adding && unmappedRisks.length === 0 && mappings.length > 0 && (
        <p className={`text-xs ${mutedColor}`}>
          All tagged protocol sections are mapped to this vendor service.
        </p>
      )}

      {/* Helper text when no risks exist at all */}
      {availableRisks.length === 0 && (
        <p className={`text-xs ${headingColor}`}>
          No protocol risks have been tagged yet. Tag sections in the{' '}
          <span className={`font-semibold`}>Intake</span> stage first.
        </p>
      )}
    </div>
  );
}

// ============================================================================
// MappingRow — view + edit modes
// ============================================================================

interface MappingRowViewProps {
  mode: 'view';
  mapping: MockServiceMapping;
  risk: TaggedSection | undefined;
  isLight: boolean;
  cardBg: string;
  onEdit: () => void;
}

interface MappingRowEditProps {
  mode: 'edit';
  mapping: MockServiceMapping;
  risk: TaggedSection | undefined;
  isLight: boolean;
  cardBg: string;
  onSave: (updates: Partial<MockServiceMapping>) => void;
  onCancel: () => void;
  onRemove: () => void;
}

type MappingRowProps = MappingRowViewProps | MappingRowEditProps;

function MappingRow(props: MappingRowProps) {
  const { mapping, risk, isLight, cardBg } = props;
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/65' : 'text-[#d2d7e0]/55';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';
  const buttonDanger = isLight
    ? 'bg-white border border-red-200 text-red-600 hover:bg-red-50'
    : 'bg-[#131a22] border border-red-500/30 text-red-400 hover:bg-red-500/[0.06]';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const inputBg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const inputBorder = isLight
    ? 'border-[#cbd2db] focus:border-[#4a6fa5] focus:ring-1 focus:ring-[#4a6fa5]/30'
    : 'border-white/15 focus:border-[#6e8fb5] focus:ring-1 focus:ring-[#6e8fb5]/30';
  const radioActive = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5] text-[#4a6fa5]'
    : 'bg-[#4a6fa5]/15 border-[#6e8fb5] text-[#6e8fb5]';
  const radioInactive = isLight
    ? 'bg-white border-[#e2e8ee] text-[#374152]/65 hover:border-[#cbd2db]'
    : 'bg-[#131a22] border-white/10 text-[#d2d7e0]/55 hover:border-white/20';

  // Edit form local state
  const [criticality, setCriticality] = useState<DerivedCriticality>(mapping.derived_criticality);
  const [rationale, setRationale] = useState<string>(mapping.criticality_rationale ?? '');

  if (props.mode === 'view') {
    return (
      <div className={`${cardBg} border rounded-lg px-4 py-3.5`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap mb-1">
              <span
                className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
                  isLight
                    ? 'bg-[#eef2f6] text-[#4a6fa5]'
                    : 'bg-white/[0.06] text-[#6e8fb5]'
                }`}
              >
                {risk?.section_identifier ?? 'unknown section'}
              </span>
              <span className={`${headingColor} text-sm font-semibold truncate`}>
                {risk?.section_title ?? '—'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <CriticalityChip criticality={mapping.derived_criticality} isLight={isLight} />
              {risk && (
                <span className={`text-[10px] ${mutedColor}`}>
                  Endpoint: {ENDPOINT_TIER_LABELS[risk.endpoint_tier]}
                </span>
              )}
            </div>
            {mapping.criticality_rationale && (
              <p className={`text-xs ${subColor} mt-2 leading-relaxed`}>
                {mapping.criticality_rationale}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={props.onEdit}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
          >
            <Pencil size={12} />
            Edit
          </button>
        </div>
      </div>
    );
  }

  // Edit mode
  return (
    <div className={`${cardBg} border rounded-lg p-4`}>
      <div className="flex items-baseline gap-2 flex-wrap mb-3">
        <span
          className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
            isLight
              ? 'bg-[#eef2f6] text-[#4a6fa5]'
              : 'bg-white/[0.06] text-[#6e8fb5]'
          }`}
        >
          {risk?.section_identifier ?? '—'}
        </span>
        <span className={`${headingColor} text-sm font-semibold`}>
          {risk?.section_title ?? '—'}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <label className={`block text-xs font-medium mb-1.5 ${headingColor}`}>
            Derived criticality
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CRITICALITY_OPTIONS.map((c) => {
              const active = criticality === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCriticality(c)}
                  className={`text-center rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${active ? radioActive : radioInactive}`}
                >
                  {DERIVED_CRITICALITY_LABELS[c]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className={`block text-xs font-medium mb-1.5 ${headingColor}`}>
            Rationale
          </label>
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={2}
            placeholder="Why this criticality? (auditor's reasoning)"
            className={`w-full rounded-md border px-2.5 py-1.5 text-xs ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() =>
              props.onSave({
                derived_criticality: criticality,
                criticality_rationale: rationale.trim() || null,
              })
            }
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
          >
            Save
          </button>
          <button
            type="button"
            onClick={props.onCancel}
            className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={props.onRemove}
            className={`ml-auto inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonDanger}`}
            title="Remove mapping"
          >
            <X size={12} />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// AddMappingForm
// ============================================================================

interface AddMappingFormProps {
  vendorServiceId: string;
  unmappedRisks: TaggedSection[];
  isLight: boolean;
  cardBg: string;
  onSubmit: (payload: Omit<MockServiceMapping, 'id'>) => void;
  onCancel: () => void;
}

function AddMappingForm({
  vendorServiceId,
  unmappedRisks,
  isLight,
  cardBg,
  onSubmit,
  onCancel,
}: AddMappingFormProps) {
  const [riskId, setRiskId] = useState<string>(unmappedRisks[0]?.id ?? '');
  const [criticality, setCriticality] = useState<DerivedCriticality>('HIGH');
  const [rationale, setRationale] = useState<string>('');

  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const inputBg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const inputBorder = isLight
    ? 'border-[#cbd2db] focus:border-[#4a6fa5] focus:ring-1 focus:ring-[#4a6fa5]/30'
    : 'border-white/15 focus:border-[#6e8fb5] focus:ring-1 focus:ring-[#6e8fb5]/30';
  const radioActive = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5] text-[#4a6fa5]'
    : 'bg-[#4a6fa5]/15 border-[#6e8fb5] text-[#6e8fb5]';
  const radioInactive = isLight
    ? 'bg-white border-[#e2e8ee] text-[#374152]/65 hover:border-[#cbd2db]'
    : 'bg-[#131a22] border-white/10 text-[#d2d7e0]/55 hover:border-white/20';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';

  return (
    <div className={`${cardBg} border rounded-lg p-4`}>
      <div className="space-y-3">
        <div>
          <label className={`block text-xs font-medium mb-1.5 ${headingColor}`}>
            Protocol section
          </label>
          <select
            value={riskId}
            onChange={(e) => setRiskId(e.target.value)}
            className={`w-full rounded-md border px-2.5 py-1.5 text-xs ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
          >
            {unmappedRisks.map((r) => (
              <option key={r.id} value={r.id}>
                {r.section_identifier} — {r.section_title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={`block text-xs font-medium mb-1.5 ${headingColor}`}>
            Derived criticality
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CRITICALITY_OPTIONS.map((c) => {
              const active = criticality === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCriticality(c)}
                  className={`text-center rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${active ? radioActive : radioInactive}`}
                >
                  {DERIVED_CRITICALITY_LABELS[c]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className={`block text-xs font-medium mb-1.5 ${headingColor}`}>
            Rationale <span className="font-normal opacity-60">(optional)</span>
          </label>
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={2}
            placeholder="Why this criticality?"
            className={`w-full rounded-md border px-2.5 py-1.5 text-xs ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              if (!riskId) return;
              onSubmit({
                vendor_service_id: vendorServiceId,
                protocol_risk_id: riskId,
                derived_criticality: criticality,
                criticality_rationale: rationale.trim() || null,
              });
            }}
            disabled={!riskId}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
          >
            Add mapping
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CriticalityChip
// ============================================================================

function CriticalityChip({
  criticality,
  isLight,
}: {
  criticality: DerivedCriticality;
  isLight: boolean;
}) {
  const tones: Record<DerivedCriticality, string> = {
    CRITICAL: isLight
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-red-500/15 border-red-500/30 text-red-300',
    HIGH: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    MODERATE: isLight
      ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]'
      : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
    LOW: isLight
      ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/65'
      : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/55',
  };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tones[criticality]}`}
    >
      {DERIVED_CRITICALITY_LABELS[criticality]}
    </span>
  );
}
