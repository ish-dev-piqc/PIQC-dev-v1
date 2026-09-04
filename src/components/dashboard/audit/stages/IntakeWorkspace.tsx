import { useState, useEffect, useMemo } from 'react';
import { Plus, Pencil, Clock, Trash2, History as HistoryIcon, Link2 } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useAuditData } from '../../../../context/AuditDataContext';
import {
  ENDPOINT_TIER_LABELS,
  IMPACT_SURFACE_LABELS,
  OPERATIONAL_DOMAIN_OPTIONS,
} from '../../../../lib/audit/labels';
import { type TaggedSection } from '../../../../lib/audit/mockProtocolRisks';
import ProtocolReadinessCard from './ProtocolReadinessCard';
import type { EndpointTier, ImpactSurface } from '../../../../types/audit';
import RiskTaggingForm, { type RiskTagFormValues } from './intake/RiskTaggingForm';
import RiskCandidatesPanel from './intake/RiskCandidatesPanel';
import { candidateProvenance, type RiskCandidate } from '../../../../lib/audit/riskCandidates';
import {
  fetchProtocolRisksForAudit,
  createProtocolRisk,
  createProtocolRiskFromCandidate,
  updateProtocolRisk,
  deleteProtocolRisk,
  type CreateProtocolRiskFromCandidateResult,
} from '../../../../lib/audit/intakeApi';
import HistoryDrawer from '../HistoryDrawer';

// =============================================================================
// IntakeWorkspace — INTAKE stage center pane
//
// Phase B mock-backed port. Auditor manually tags protocol sections that the
// vendor is responsible for. Each tagged section anchors downstream
// criticality scoring, questionnaire addenda, and the risk summary.
//
// Manual tagging plus PIQC-assisted candidates: the suggestions panel derives
// proposals from the parsed protocol (riskCandidates.ts, deterministic), and
// Accept opens the same form prefilled — the auditor confirms, the row records
// PIQC_ASSISTED with provenance. LLM-assisted tagging is not built.
//
// Wired to Supabase: reads via fetchProtocolRisksForAudit, writes via the
// per-mutation RPCs (createProtocolRisk etc.) — the shared context store
// propagates edits to the other stages that consume it.
// =============================================================================

type FormMode = 'list' | 'add' | 'edit';

export default function IntakeWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  // Shared store across stages (Phase B). Mutations propagate to other stages
  // that consume the same context (e.g. Vendor Enrichment's mapping picker
  // and Scope Review's read-only summary).
  const { protocolRisks: sectionsByAudit, setProtocolRisks: setSectionsByAudit } =
    useAuditData();

  const [mode, setMode] = useState<FormMode>('list');
  const [editTarget, setEditTarget] = useState<TaggedSection | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<{ objectId: string; title: string } | null>(null);
  // AUD-301: surface a save failure instead of silently swallowing the null.
  const [saveError, setSaveError] = useState<string | null>(null);
  // A candidate accepted from the suggestions panel: the form is prefilled
  // from it and the save goes through the candidate RPC so the row records
  // PIQC_ASSISTED + provenance.
  const [pendingCandidate, setPendingCandidate] = useState<RiskCandidate | null>(null);
  // Row saved through the manual path because the candidate RPC is not applied
  // in this environment yet — that row carries the note.
  const [fallbackNoteRiskId, setFallbackNoteRiskId] = useState<string | null>(null);

  // Load protocol risks from Supabase when the active audit changes
  useEffect(() => {
    if (!activeAudit) return;
    const auditIdLocal = activeAudit.id;
    // Cancellation latch (PR-2): a slow fetch resolving after an audit
    // switch must not flip `loading` mid-render of the next audit — the
    // sibling workspaces all carry this guard.
    let cancelled = false;

    const loadRisks = async () => {
      setLoading(true);
      const risks = await fetchProtocolRisksForAudit(auditIdLocal);
      if (cancelled) return;
      setSectionsByAudit((prev) => ({
        ...prev,
        [auditIdLocal]: risks,
      }));
      setLoading(false);
    };

    loadRisks();
    setMode('list');
    setEditTarget(null);
    setPendingCandidate(null);
    return () => {
      cancelled = true;
    };
    // Depend on activeAudit?.id only — see RiskSummaryPanel for rationale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudit?.id, setSectionsByAudit]);

  // RiskTaggingForm resets its fields whenever the `initialValues` reference
  // changes, so the proposal must be a stable object per candidate — an
  // inline literal would wipe the auditor's edits on the re-render a save
  // failure causes.
  const candidateInitialValues = useMemo<Partial<RiskTagFormValues> | undefined>(
    () =>
      pendingCandidate
        ? {
            section_identifier: pendingCandidate.section_identifier,
            section_title: pendingCandidate.section_title,
            endpoint_tier: pendingCandidate.endpoint_tier,
            impact_surface: pendingCandidate.impact_surface,
            time_sensitivity: pendingCandidate.time_sensitivity,
            vendor_dependency_flags: [],
            operational_domain_tag: '',
            source_extracted_item_id: pendingCandidate.source_extracted_item_id,
          }
        : undefined,
    [pendingCandidate],
  );

  if (!activeAudit) {
    // Shell should have rendered the gate, but guard for defensive rendering.
    return null;
  }

  const sections = sectionsByAudit[activeAudit.id] ?? [];

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleAdd = async (values: RiskTagFormValues) => {
    setLoading(true);
    const common = {
      sectionIdentifier: values.section_identifier,
      sectionTitle: values.section_title,
      endpointTier: values.endpoint_tier,
      impactSurface: values.impact_surface,
      timeSensitivity: values.time_sensitivity,
      vendorDependencyFlags: values.vendor_dependency_flags,
      operationalDomainTag: values.operational_domain_tag,
    };
    // The candidate path applies only while the row still traces to the
    // candidate's item. Unlinking or re-linking in the form makes it a manual
    // tag — provenance for one item must never be stored against another.
    const candidate =
      pendingCandidate &&
      values.source_extracted_item_id === pendingCandidate.source_extracted_item_id
        ? pendingCandidate
        : null;

    let recordedManually = false;
    let result: CreateProtocolRiskFromCandidateResult;
    if (candidate) {
      result = await createProtocolRiskFromCandidate(
        activeAudit.protocol_version_id,
        { ...common, sourceExtractedItemId: candidate.source_extracted_item_id },
        candidateProvenance(candidate),
      );
      if (!result.ok && result.notApplied) {
        // RPC not pushed to this environment yet: keep the row and its source
        // link, lose only the provenance, and say so on the row.
        recordedManually = true;
        result = await createProtocolRisk(activeAudit.protocol_version_id, {
          ...common,
          versionChangeType: 'ADDED',
          sourceExtractedItemId: candidate.source_extracted_item_id,
        });
      }
    } else {
      result = await createProtocolRisk(activeAudit.protocol_version_id, {
        ...common,
        versionChangeType: 'ADDED',
        sourceExtractedItemId: values.source_extracted_item_id,
      });
    }

    if (result.ok) {
      const saved = result.data;
      setSaveError(null);
      setFallbackNoteRiskId(recordedManually ? saved.id : null);
      setSectionsByAudit((prev) => ({
        ...prev,
        [activeAudit.id]: [...(prev[activeAudit.id] ?? []), saved],
      }));
      setPendingCandidate(null);
      setMode('list');
    } else {
      // Keep the form open so the auditor can retry without re-entering the tag.
      setSaveError(result.error);
    }
    setLoading(false);
  };

  const handleEdit = async (values: RiskTagFormValues) => {
    if (!editTarget) return;
    setLoading(true);
    // Source-link mutation under three-way semantics:
    //   - was set, now cleared  → clearSourceExtractedItemId = true
    //   - was set/null, now set → sourceExtractedItemId = new value
    //   - unchanged             → send neither
    const sourceBefore = editTarget.source_extracted_item_id ?? null;
    const sourceAfter = values.source_extracted_item_id;
    const sourceUpdate: {
      sourceExtractedItemId?: string;
      clearSourceExtractedItemId?: boolean;
    } = {};
    if (sourceAfter === null && sourceBefore !== null) {
      sourceUpdate.clearSourceExtractedItemId = true;
    } else if (sourceAfter !== null && sourceAfter !== sourceBefore) {
      sourceUpdate.sourceExtractedItemId = sourceAfter;
    }

    const updated = await updateProtocolRisk(editTarget.id, {
      endpointTier: values.endpoint_tier,
      impactSurface: values.impact_surface,
      timeSensitivity: values.time_sensitivity,
      vendorDependencyFlags: values.vendor_dependency_flags,
      operationalDomainTag: values.operational_domain_tag,
      versionChangeType: editTarget.version_change_type === 'ADDED' ? 'ADDED' : 'MODIFIED',
      ...sourceUpdate,
    });
    if (updated) {
      setSectionsByAudit((prev) => ({
        ...prev,
        [activeAudit.id]: (prev[activeAudit.id] ?? []).map((s) =>
          s.id === editTarget.id ? updated : s,
        ),
      }));
    }
    setMode('list');
    setEditTarget(null);
    setLoading(false);
  };

  const openAdd = () => {
    setEditTarget(null);
    setPendingCandidate(null);
    setMode('add');
  };

  const openAddFromCandidate = (candidate: RiskCandidate) => {
    setEditTarget(null);
    setPendingCandidate(candidate);
    setMode('add');
  };

  const openEdit = (section: TaggedSection) => {
    setEditTarget(section);
    setPendingCandidate(null);
    setMode('edit');
  };

  const cancel = () => {
    setMode('list');
    setEditTarget(null);
    setPendingCandidate(null);
  };

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const formCardBg = isLight
    ? 'bg-[#F8FAFC] border-[#E2E8F0]'
    : 'bg-white/[0.02] border-white/5';
  const emptyBg = isLight
    ? 'border-[#E2E8F0] bg-[#F8FAFC]/40'
    : 'border-white/5 bg-white/[0.01]';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700';

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
            disabled={loading}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors disabled:opacity-50 ${buttonPrimary}`}
          >
            <Plus size={14} />
            {loading ? 'Loading…' : 'Tag a section'}
          </button>
        )}
      </div>

      {/* Parse status of the audit's protocol + the guarded upload path. The
          source-item picker in the form below lists nothing until this reads
          "Parsed". Hidden while the form is open so the form keeps the pane. */}
      {!inForm && <ProtocolReadinessCard />}

      {/* Candidates derived from the parsed items the card above reports on.
          `tagged` is the same store the list below renders from, so an
          accepted candidate leaves the suggestions as soon as it is saved. */}
      {!inForm && (
        <RiskCandidatesPanel
          protocolId={activeAudit.protocol_id}
          tagged={sections}
          disabled={loading}
          onAccept={openAddFromCandidate}
        />
      )}

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
                    source_extracted_item_id: editTarget.source_extracted_item_id,
                  }
                : candidateInitialValues
            }
            onSubmit={mode === 'add' ? handleAdd : handleEdit}
            onCancel={cancel}
            protocolId={activeAudit.protocol_id}
            protocolCode={activeAudit.protocol_code}
          />
          {saveError && (
            <div
              role="alert"
              className={`text-xs px-3 py-2 mt-4 rounded-md border ${
                isLight
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-red-500/15 border-red-500/30 text-red-300'
              }`}
            >
              Couldn’t save this section: {saveError}
            </div>
          )}
        </div>
      )}

      {/* List */}
      {/* Loading: show a skeleton while the initial fetch is in flight so the
          empty-state copy below never flashes before data arrives (AUD-401). */}
      {!inForm && loading && sections.length === 0 && (
        <div
          className={`border border-dashed rounded-xl px-6 py-10 text-center ${emptyBg}`}
        >
          <p className={`${subColor} text-sm`}>Loading sections…</p>
        </div>
      )}

      {!inForm && !loading && sections.length === 0 && (
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
                onDelete={async () => {
                  setLoading(true);
                  const success = await deleteProtocolRisk(s.id);
                  if (success) {
                    setSectionsByAudit((prev) => ({
                      ...prev,
                      [activeAudit.id]: (prev[activeAudit.id] ?? []).filter(
                        (r) => r.id !== s.id,
                      ),
                    }));
                  }
                  setLoading(false);
                }}
                onHistoryClick={() =>
                  setHistoryTarget({ objectId: s.id, title: s.section_title })
                }
                note={
                  s.id === fallbackNoteRiskId
                    ? 'Recorded as manually tagged — PIQC-assisted provenance isn’t available in this environment yet.'
                    : null
                }
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

      {historyTarget && (
        <HistoryDrawer
          objectType="PROTOCOL_RISK_OBJECT"
          objectId={historyTarget.objectId}
          title={historyTarget.title}
          onClose={() => setHistoryTarget(null)}
        />
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
  onDelete: () => Promise<void>;
  onHistoryClick: () => void;
  /** One-line caveat under the row, e.g. the pre-apply fallback note. */
  note: string | null;
  isLight: boolean;
  cardBg: string;
  headingColor: string;
  subColor: string;
  mutedColor: string;
}

function SectionRow({
  section,
  onEdit,
  onDelete,
  onHistoryClick,
  note,
  isLight,
  cardBg,
  headingColor,
  subColor,
  mutedColor,
}: SectionRowProps) {
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';

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
                  ? 'bg-[#F2F2F2] text-brand-600'
                  : 'bg-white/[0.06] text-brand-300'
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
            {section.source_extracted_item_id && <SourceLinkedChip isLight={isLight} />}
            {section.tagging_mode !== 'MANUAL' && <PiqcAssistedChip isLight={isLight} />}
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
              title="Change history"
              onClick={onHistoryClick}
            >
              <HistoryIcon size={11} />
              History
            </button>
            {section.version_change_type === 'MODIFIED' && (
              <span className={`text-[11px] ${mutedColor}`}>· Re-tagged</span>
            )}
          </div>
          {note && <p className={`text-[11px] mt-2 ${mutedColor}`}>{note}</p>}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
          >
            <Pencil size={12} />
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete tagged section "${section.section_title}"? This cannot be undone.`)) {
                void onDelete();
              }
            }}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
            title="Delete tagged section"
            aria-label="Delete tagged section"
          >
            <Trash2 size={12} />
          </button>
        </div>
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
      ? 'bg-brand-600/10 border-brand-600/25 text-brand-600'
      : 'bg-brand-300/15 border-brand-300/30 text-brand-300',
    SUPPORTIVE: isLight
      ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/65'
      : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/55',
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
      ? 'bg-brand-600/10 border-brand-600/25 text-brand-600'
      : 'bg-brand-300/15 border-brand-300/30 text-brand-300',
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
          ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/70'
          : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/65'
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

// The row was accepted from a PIQC proposal (tagging_mode PIQC_ASSISTED).
// History shows what PIQC proposed against what the auditor saved.
function PiqcAssistedChip({ isLight }: ChipProps) {
  return (
    <span
      title="Proposed by PIQC from the parsed protocol, confirmed by the auditor"
      className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${
        isLight
          ? 'bg-brand-600/10 border-brand-600/25 text-brand-600'
          : 'bg-brand-300/15 border-brand-300/30 text-brand-300'
      }`}
    >
      PIQC-assisted
    </span>
  );
}

// Indicates the risk traces back to a parsed protocol source item. Inspecting
// which item is one click away via the edit form's "View" button.
function SourceLinkedChip({ isLight }: ChipProps) {
  return (
    <span
      title="Linked to a parsed protocol source item"
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${
        isLight
          ? 'bg-[#F2F2F2] border-[#CBD5E1] text-brand-600'
          : 'bg-white/[0.06] border-white/10 text-brand-300'
      }`}
    >
      <Link2 size={10} />
      Source linked
    </span>
  );
}
