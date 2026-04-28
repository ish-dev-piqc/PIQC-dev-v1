import { useState, useEffect } from 'react';
import { Plus, Pencil, Clock, History as HistoryIcon } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import {
  ENDPOINT_TIER_LABELS,
  IMPACT_SURFACE_LABELS,
  OPERATIONAL_DOMAIN_OPTIONS,
} from '../../../../lib/audit/labels';
import {
  MOCK_PROTOCOL_RISKS,
  type TaggedSection,
} from '../../../../lib/audit/mockProtocolRisks';
import type { EndpointTier, ImpactSurface } from '../../../../types/audit';
import RiskTaggingForm, { type RiskTagFormValues } from './intake/RiskTaggingForm';

// =============================================================================
// IntakeWorkspace — INTAKE stage center pane
//
// Phase B mock-backed port. Auditor manually tags protocol sections that the
// vendor is responsible for. Each tagged section anchors downstream
// criticality scoring, questionnaire addenda, and the risk summary.
//
// Phase 1 = manual (this build). Phase 2 = PIQC-assisted (sections arrive
// pre-populated). Phase 3 = LLM-assisted. The form is suggestion-aware in
// shape from day one — those phases swap data sources, not UI.
//
// Phase A pattern: in-session local state. Edits/adds persist while the tab
// is open; refresh resets to mock baseline. Replace with Supabase calls when
// per-mutation RPCs land.
// =============================================================================

type FormMode = 'list' | 'add' | 'edit';

export default function IntakeWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  // In-session sections store, keyed by audit id. Initialized from the mock
  // baseline; mutations update this state.
  const [sectionsByAudit, setSectionsByAudit] = useState<
    Record<string, TaggedSection[]>
  >(() => ({ ...MOCK_PROTOCOL_RISKS }));

  const [mode, setMode] = useState<FormMode>('list');
  const [editTarget, setEditTarget] = useState<TaggedSection | null>(null);

  // Reset form state when the active audit changes.
  useEffect(() => {
    setMode('list');
    setEditTarget(null);
  }, [activeAudit?.id]);

  if (!activeAudit) {
    // Shell should have rendered the gate, but guard for defensive rendering.
    return null;
  }

  const sections = sectionsByAudit[activeAudit.id] ?? [];

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleAdd = (values: RiskTagFormValues) => {
    const newSection: TaggedSection = {
      id: `pr-${activeAudit.id}-${Date.now()}`,
      section_identifier: values.section_identifier,
      section_title: values.section_title,
      endpoint_tier: values.endpoint_tier,
      impact_surface: values.impact_surface,
      time_sensitivity: values.time_sensitivity,
      vendor_dependency_flags: values.vendor_dependency_flags,
      operational_domain_tag: values.operational_domain_tag,
      tagging_mode: 'MANUAL',
      version_change_type: 'ADDED',
    };
    setSectionsByAudit((prev) => ({
      ...prev,
      [activeAudit.id]: [...(prev[activeAudit.id] ?? []), newSection],
    }));
    setMode('list');
  };

  const handleEdit = (values: RiskTagFormValues) => {
    if (!editTarget) return;
    setSectionsByAudit((prev) => ({
      ...prev,
      [activeAudit.id]: (prev[activeAudit.id] ?? []).map((s) =>
        s.id === editTarget.id
          ? {
              ...s,
              endpoint_tier: values.endpoint_tier,
              impact_surface: values.impact_surface,
              time_sensitivity: values.time_sensitivity,
              vendor_dependency_flags: values.vendor_dependency_flags,
              operational_domain_tag: values.operational_domain_tag,
              version_change_type:
                s.version_change_type === 'ADDED' ? 'ADDED' : 'MODIFIED',
            }
          : s,
      ),
    }));
    setMode('list');
    setEditTarget(null);
  };

  const openAdd = () => {
    setEditTarget(null);
    setMode('add');
  };

  const openEdit = (section: TaggedSection) => {
    setEditTarget(section);
    setMode('edit');
  };

  const cancel = () => {
    setMode('list');
    setEditTarget(null);
  };

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/65' : 'text-[#d2d7e0]/55';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const sectionHeader = isLight ? 'text-[#374152]/45' : 'text-[#d2d7e0]/40';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const formCardBg = isLight
    ? 'bg-[#f9fafc] border-[#e2e8ee]'
    : 'bg-white/[0.02] border-white/5';
  const emptyBg = isLight
    ? 'border-[#e2e8ee] bg-[#f9fafc]/40'
    : 'border-white/5 bg-white/[0.01]';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';

  const inForm = mode !== 'list';

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
            Stage 1 · Intake
          </p>
          <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
            Protocol section tagging
          </h2>
          <p className={`${subColor} text-sm mt-1.5 leading-relaxed max-w-2xl`}>
            Tag every protocol section your vendor is responsible for. The endpoint tier,
            impact surface, and operational domain you record here anchor criticality
            scoring, questionnaire addenda, and the risk summary downstream.
          </p>
        </div>
        {!inForm && (
          <button
            type="button"
            onClick={openAdd}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary}`}
          >
            <Plus size={14} />
            Tag a section
          </button>
        )}
      </div>

      {/* Inline form */}
      {inForm && (
        <div className={`${formCardBg} border rounded-xl p-5`}>
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold mb-4`}>
            {mode === 'add' ? 'New section' : 'Edit section'}
          </p>
          <RiskTaggingForm
            mode={mode}
            initialValues={
              editTarget
                ? {
                    section_identifier: editTarget.section_identifier,
                    section_title: editTarget.section_title,
                    endpoint_tier: editTarget.endpoint_tier,
                    impact_surface: editTarget.impact_surface,
                    time_sensitivity: editTarget.time_sensitivity,
                    vendor_dependency_flags: editTarget.vendor_dependency_flags,
                    operational_domain_tag: editTarget.operational_domain_tag,
                  }
                : undefined
            }
            onSubmit={mode === 'add' ? handleAdd : handleEdit}
            onCancel={cancel}
          />
        </div>
      )}

      {/* List */}
      {!inForm && sections.length === 0 && (
        <div
          className={`border border-dashed rounded-xl px-6 py-10 text-center ${emptyBg}`}
        >
          <p className={`${subColor} text-sm`}>
            No sections tagged yet. Use <span className={`${headingColor} font-medium`}>Tag a section</span> to record the first protocol risk.
          </p>
        </div>
      )}

      {!inForm && sections.length > 0 && (
        <div className="space-y-3">
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
            {sections.length} section{sections.length === 1 ? '' : 's'} tagged
          </p>
          <div className="space-y-2">
            {sections.map((s) => (
              <SectionRow
                key={s.id}
                section={s}
                onEdit={() => openEdit(s)}
                isLight={isLight}
                cardBg={cardBg}
                headingColor={headingColor}
                subColor={subColor}
                mutedColor={mutedColor}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Section row
// ============================================================================

interface SectionRowProps {
  section: TaggedSection;
  onEdit: () => void;
  isLight: boolean;
  cardBg: string;
  headingColor: string;
  subColor: string;
  mutedColor: string;
}

function SectionRow({
  section,
  onEdit,
  isLight,
  cardBg,
  headingColor,
  subColor,
  mutedColor,
}: SectionRowProps) {
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';

  const domainLabel =
    OPERATIONAL_DOMAIN_OPTIONS.find((o) => o.value === section.operational_domain_tag)?.label ??
    section.operational_domain_tag;

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
              {section.section_identifier}
            </span>
            <span className={`${headingColor} text-sm font-semibold truncate`}>
              {section.section_title}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <TierChip tier={section.endpoint_tier} isLight={isLight} />
            <SurfaceChip surface={section.impact_surface} isLight={isLight} />
            <DomainChip label={domainLabel} isLight={isLight} />
            {section.time_sensitivity && <TimeSensitiveChip isLight={isLight} />}
            {section.vendor_dependency_flags.length > 0 && (
              <span className={`text-[11px] ${mutedColor}`}>
                · {section.vendor_dependency_flags.length} dependency
                {section.vendor_dependency_flags.length === 1 ? '' : 'ies'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2.5">
            <button
              type="button"
              className={`inline-flex items-center gap-1 text-[11px] ${subColor} hover:underline`}
              title="Change history (Phase B wires real history)"
              onClick={() => {
                /* placeholder — wire to getObjectHistory in Phase B */
              }}
            >
              <HistoryIcon size={11} />
              History
            </button>
            {section.version_change_type === 'MODIFIED' && (
              <span className={`text-[11px] ${mutedColor}`}>· Re-tagged</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
        >
          <Pencil size={12} />
          Edit
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Chip components
// ============================================================================

interface ChipProps {
  isLight: boolean;
}

function TierChip({ tier, isLight }: { tier: EndpointTier; isLight: boolean }) {
  // Each tier gets its own tone so glance-scanning a list reads instantly.
  const tones: Record<EndpointTier, string> = {
    PRIMARY: isLight
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-red-500/15 border-red-500/30 text-red-300',
    SAFETY: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    SECONDARY: isLight
      ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]'
      : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
    SUPPORTIVE: isLight
      ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/65'
      : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/55',
  };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tones[tier]}`}
    >
      {ENDPOINT_TIER_LABELS[tier]}
    </span>
  );
}

function SurfaceChip({ surface, isLight }: { surface: ImpactSurface; isLight: boolean }) {
  const tones: Record<ImpactSurface, string> = {
    BOTH: isLight
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-red-500/15 border-red-500/30 text-red-300',
    PATIENT_SAFETY: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    DATA_INTEGRITY: isLight
      ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]'
      : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
  };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${tones[surface]}`}
    >
      {IMPACT_SURFACE_LABELS[surface]}
    </span>
  );
}

function DomainChip({ label, isLight }: { label: string; isLight: boolean }) {
  return (
    <span
      className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${
        isLight
          ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/70'
          : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/65'
      }`}
    >
      {label}
    </span>
  );
}

function TimeSensitiveChip({ isLight }: ChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${
        isLight
          ? 'bg-amber-50/60 border-amber-200/80 text-amber-700'
          : 'bg-amber-500/[0.08] border-amber-500/20 text-amber-300'
      }`}
    >
      <Clock size={10} />
      Time-sensitive
    </span>
  );
}
