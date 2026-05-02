import { useState, useEffect } from 'react';
import {
  Plus,
  Pencil,
  AlertTriangle,
  History as HistoryIcon,
  ArrowRight,
  Link2,
} from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useAuditData } from '../../../../context/AuditDataContext';
import {
  PROVISIONAL_IMPACT_LABELS,
  PROVISIONAL_CLASSIFICATION_LABELS,
} from '../../../../lib/audit/labels';
import { type TaggedSection } from '../../../../lib/audit/mockProtocolRisks';
import { type MockWorkspaceEntry } from '../../../../lib/audit/mockWorkspaceEntries';
import {
  fetchWorkspaceEntries,
  createWorkspaceEntry,
  updateWorkspaceEntry,
} from '../../../../lib/audit/workspaceEntriesApi';
import HeatIndicator from '../../../heatmap/HeatIndicator';
import { scoreWorkspaceEntry } from '../../../../lib/heatmap';
import type {
  ProvisionalClassification,
  ProvisionalImpact,
} from '../../../../types/audit';
import HistoryDrawer from '../HistoryDrawer';

// =============================================================================
// AuditConductWorkspace — AUDIT_CONDUCT stage center pane.
//
// Auditors record structured observations during the audit day. Each entry is
// an AuditWorkspaceEntryObject. D-008 (decided): only human-governed fields
// are exposed (provisional_impact + provisional_classification). No coherence
// proposals, no automated flags.
//
// risk_context_outdated chip surfaces passively when an entry's linked
// ProtocolRiskObject was modified or removed via amendment — the auditor must
// re-confirm the entry against the new version.
// =============================================================================

const IMPACT_OPTIONS: ProvisionalImpact[] = ['CRITICAL', 'MAJOR', 'MINOR', 'OBSERVATION', 'NONE'];
const CLASSIFICATION_OPTIONS: ProvisionalClassification[] = [
  'FINDING',
  'OBSERVATION',
  'OPPORTUNITY_FOR_IMPROVEMENT',
  'NOT_YET_CLASSIFIED',
];

interface EntryFormState {
  vendor_domain: string;
  observation_text: string;
  provisional_impact: ProvisionalImpact;
  provisional_classification: ProvisionalClassification;
  checkpoint_ref: string;
  protocol_risk_id: string;
}

const EMPTY_FORM: EntryFormState = {
  vendor_domain: '',
  observation_text: '',
  provisional_impact: 'NONE',
  provisional_classification: 'NOT_YET_CLASSIFIED',
  checkpoint_ref: '',
  protocol_risk_id: '',
};

type FormMode = 'list' | 'add' | 'edit';

export default function AuditConductWorkspace() {
  const { theme } = useTheme();
  const { activeAudit, advanceStage } = useAudit();
  const isLight = theme === 'light';

  const {
    workspaceEntries: entriesByAudit,
    setWorkspaceEntries: setEntriesByAudit,
    protocolRisks,
  } = useAuditData();
  const [mode, setMode] = useState<FormMode>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EntryFormState>(EMPTY_FORM);
  const [historyTarget, setHistoryTarget] = useState<{ objectId: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset edit state on audit switch.
  useEffect(() => {
    setMode('list');
    setEditingId(null);
    setForm(EMPTY_FORM);
  }, [activeAudit?.id]);

  // Hydrate workspace entries from Supabase whenever the active audit changes.
  // Avoids re-fetching if we already have entries for this audit (e.g. user
  // navigated away and back within the same session and we already loaded).
  useEffect(() => {
    if (!activeAudit) return;
    const auditIdLocal = activeAudit.id;
    let cancelled = false;
    void (async () => {
      const rows = await fetchWorkspaceEntries(auditIdLocal);
      if (cancelled) return;
      setEntriesByAudit((prev) => ({ ...prev, [auditIdLocal]: rows }));
    })();
    return () => {
      cancelled = true;
    };
    // Depend on activeAudit?.id only — see RiskSummaryPanel for rationale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudit?.id, setEntriesByAudit]);

  if (!activeAudit) return null;

  const auditId = activeAudit.id;
  const entries = entriesByAudit[auditId] ?? [];
  const auditProtocolRisks = protocolRisks[auditId] ?? [];

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setMode('add');
  };

  const openEdit = (entry: MockWorkspaceEntry) => {
    setEditingId(entry.id);
    setForm({
      vendor_domain: entry.vendor_domain,
      observation_text: entry.observation_text,
      provisional_impact: entry.provisional_impact,
      provisional_classification: entry.provisional_classification,
      checkpoint_ref: entry.checkpoint_ref ?? '',
      protocol_risk_id: entry.protocol_risk_id ?? '',
    });
    setMode('edit');
  };

  const cancel = () => {
    setMode('list');
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  // saveEntry: persists via RPC, then merges the canonical row back into the
  // shared store. We don't optimistically mutate before the RPC because the
  // server stamps `created_by_name` and the risk-attr snapshot — letting the
  // RPC be source of truth keeps the UI honest.
  const saveEntry = async () => {
    if (saving) return;
    if (!form.vendor_domain.trim() || !form.observation_text.trim()) return;

    setSaving(true);
    const checkpointInput = form.checkpoint_ref.trim();

    if (mode === 'add') {
      const created = await createWorkspaceEntry(auditId, {
        vendorDomain: form.vendor_domain.trim(),
        observationText: form.observation_text.trim(),
        provisionalImpact: form.provisional_impact,
        provisionalClassification: form.provisional_classification,
        checkpointRef: checkpointInput || null,
        protocolRiskId: form.protocol_risk_id || null,
      });
      if (created) {
        setEntriesByAudit((prev) => ({
          ...prev,
          [auditId]: [...(prev[auditId] ?? []), created],
        }));
        cancel();
      }
    } else if (mode === 'edit' && editingId) {
      const previous = (entriesByAudit[auditId] ?? []).find((e) => e.id === editingId);
      // Build an UpdateWorkspaceEntryInput that only sends fields the user
      // actually changed. The RPC ignores nulls, so undefined-vs-null matters.
      const updated = await updateWorkspaceEntry(editingId, {
        vendorDomain: form.vendor_domain.trim(),
        observationText: form.observation_text.trim(),
        provisionalImpact: form.provisional_impact,
        provisionalClassification: form.provisional_classification,
        checkpointRef: checkpointInput || null,
        clearCheckpointRef: !checkpointInput && !!previous?.checkpoint_ref,
      });
      if (updated) {
        setEntriesByAudit((prev) => ({
          ...prev,
          [auditId]: (prev[auditId] ?? []).map((e) => (e.id === editingId ? updated : e)),
        }));
        cancel();
      }
    }
    setSaving(false);
  };

  // Note: workspace entries are NOT deletable (GxP audit-trail invariant —
  // observations are corrected via update, never removed). See rv1_code/lib/
  // workspace-entries.ts for the reference implementation.

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
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
  const canSave = !!form.vendor_domain.trim() && !!form.observation_text.trim();

  const alreadyAdvanced = ['REPORT_DRAFTING', 'FINAL_REVIEW_EXPORT'].includes(
    activeAudit.current_stage,
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
            Stage 6 · Audit conduct
          </p>
          <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
            Structured observations
          </h2>
          <p className={`${subColor} text-sm mt-1.5 leading-relaxed max-w-2xl`}>
            Record observations as you go. Each entry can link to a tagged protocol section so
            risk attributes inherit at link time. Impact and classification are auditor-assigned
            — the system does not propose or score automatically.
          </p>
        </div>
        {!inForm && (
          <button
            type="button"
            onClick={openAdd}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary}`}
          >
            <Plus size={14} />
            New entry
          </button>
        )}
      </div>

      {/* Inline form */}
      {inForm && (
        <div className={`${formCardBg} border rounded-xl p-5`}>
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold mb-4`}>
            {mode === 'add' ? 'New observation' : 'Edit observation'}
          </p>
          <EntryForm
            form={form}
            onChange={setForm}
            protocolRisks={auditProtocolRisks}
            isLight={isLight}
          />
          <div className={`flex items-center gap-2 pt-4 mt-4 border-t ${isLight ? 'border-[#e2e8ee]' : 'border-white/5'}`}>
            <button
              type="button"
              onClick={saveEntry}
              disabled={!canSave || saving}
              className={`text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
            >
              {saving ? 'Saving…' : mode === 'add' ? 'Save entry' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={cancel}
              className={`text-sm font-medium px-3.5 py-2 rounded-md transition-colors ${
                isLight
                  ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
                  : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]'
              }`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Entry list */}
      {!inForm && entries.length === 0 && (
        <div className={`border border-dashed rounded-xl px-6 py-10 text-center ${emptyBg}`}>
          <p className={`${subColor} text-sm`}>
            No observations recorded yet. Use{' '}
            <span className={`${headingColor} font-medium`}>New entry</span> to capture the first
            observation.
          </p>
        </div>
      )}

      {!inForm && entries.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              {entries.length} observation{entries.length === 1 ? '' : 's'} recorded
            </p>
            <EntryCounts entries={entries} isLight={isLight} />
          </div>
          <div className="space-y-2">
            {entries.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                protocolRisk={
                  e.protocol_risk_id
                    ? auditProtocolRisks.find((r) => r.id === e.protocol_risk_id) ?? null
                    : null
                }
                onEdit={() => openEdit(e)}
                onHistoryClick={() => setHistoryTarget({ objectId: e.id })}
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
          objectType="AUDIT_WORKSPACE_ENTRY_OBJECT"
          objectId={historyTarget.objectId}
          title="Workspace entry"
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {/* Stage transition */}
      <div className={`${cardBg} border rounded-xl p-5`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              Stage transition
            </p>
            <p className={`${headingColor} text-sm font-semibold mt-1`}>
              {alreadyAdvanced
                ? 'Audit has already advanced past this stage'
                : entries.length === 0
                ? 'Capture at least one observation before advancing'
                : 'Ready to advance to Report drafting'}
            </p>
            <p className={`${subColor} text-xs mt-1`}>
              {alreadyAdvanced
                ? `Current stage: ${activeAudit.current_stage.replace(/_/g, ' ').toLowerCase()}`
                : 'Report drafting (Stage 7) is a Phase 2 deliverable. The advance button moves the audit forward; the report workspace ships as a placeholder.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => advanceStage('REPORT_DRAFTING')}
            disabled={entries.length === 0 || alreadyAdvanced}
            className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${
              isLight
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-[#cbd2db]'
                : 'bg-emerald-500 text-[#0d1118] hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/35'
            }`}
          >
            Advance to Report drafting
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// EntryForm
// ============================================================================

interface EntryFormProps {
  form: EntryFormState;
  onChange: (next: EntryFormState) => void;
  protocolRisks: TaggedSection[];
  isLight: boolean;
}

function EntryForm({ form, onChange, protocolRisks, isLight }: EntryFormProps) {
  const labelColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const headingColor = 'text-fg-heading';
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

  const linkedRisk = form.protocol_risk_id
    ? protocolRisks.find((r) => r.id === form.protocol_risk_id) ?? null
    : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-[1fr,2fr] gap-4">
        <div>
          <label className={`block text-sm font-medium mb-1.5 ${labelColor}`}>
            Vendor domain
          </label>
          <input
            type="text"
            value={form.vendor_domain}
            onChange={(e) => onChange({ ...form, vendor_domain: e.target.value })}
            placeholder="e.g. Validation, Device hygiene"
            className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
          />
        </div>
        <div>
          <label className={`block text-sm font-medium mb-1.5 ${labelColor}`}>
            Linked protocol section <span className="font-normal opacity-60">(optional)</span>
          </label>
          <select
            value={form.protocol_risk_id}
            onChange={(e) => onChange({ ...form, protocol_risk_id: e.target.value })}
            className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
          >
            <option value="">— None —</option>
            {protocolRisks.map((r) => (
              <option key={r.id} value={r.id}>
                {r.section_identifier} — {r.section_title}
              </option>
            ))}
          </select>
          {linkedRisk && (
            <p className={`text-[11px] mt-1 ${subColor}`}>
              Risk attributes copied at link time:{' '}
              {linkedRisk.endpoint_tier.toLowerCase()} endpoint ·{' '}
              {linkedRisk.impact_surface.replace('_', ' ').toLowerCase()}
              {linkedRisk.time_sensitivity ? ' · time-sensitive' : ''}
            </p>
          )}
        </div>
      </div>

      <div>
        <label className={`block text-sm font-medium mb-1.5 ${labelColor}`}>
          Observation
        </label>
        <textarea
          value={form.observation_text}
          onChange={(e) => onChange({ ...form, observation_text: e.target.value })}
          rows={4}
          placeholder="What did you observe? Be specific — this becomes the report record."
          className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label className={`block text-sm font-medium mb-2 ${labelColor}`}>
            Provisional impact
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {IMPACT_OPTIONS.map((i) => {
              const active = form.provisional_impact === i;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onChange({ ...form, provisional_impact: i })}
                  className={`text-center rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${
                    active ? radioActive : radioInactive
                  }`}
                >
                  {PROVISIONAL_IMPACT_LABELS[i]}
                </button>
              );
            })}
          </div>
          <p className={`text-[11px] mt-1.5 ${mutedColor}`}>
            Auditor judgment. The system never proposes impact automatically.
          </p>
        </div>
        <div>
          <label className={`block text-sm font-medium mb-2 ${labelColor}`}>
            Classification
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {CLASSIFICATION_OPTIONS.map((c) => {
              const active = form.provisional_classification === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange({ ...form, provisional_classification: c })}
                  className={`text-center rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${
                    active ? radioActive : radioInactive
                  }`}
                >
                  {PROVISIONAL_CLASSIFICATION_LABELS[c]}
                </button>
              );
            })}
          </div>
          <p className={`text-[11px] mt-1.5 ${mutedColor}`}>
            Provisional only — finalised in the report.
          </p>
        </div>
      </div>

      <div>
        <label className={`block text-sm font-medium mb-1.5 ${labelColor}`}>
          Checkpoint reference{' '}
          <span className="font-normal opacity-60">(SOP / section, optional)</span>
        </label>
        <input
          type="text"
          value={form.checkpoint_ref}
          onChange={(e) => onChange({ ...form, checkpoint_ref: e.target.value })}
          placeholder="e.g. SOP-VAL-001 §2.3"
          className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
        />
        <p className={`text-[11px] mt-1 ${mutedColor}`}>
          Plain text in Phase 1; replaced by structured checkpoint refs once SOP parsing lands.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// EntryRow
// ============================================================================

interface EntryRowProps {
  entry: MockWorkspaceEntry;
  protocolRisk: TaggedSection | null;
  onEdit: () => void;
  onHistoryClick: () => void;
  isLight: boolean;
  cardBg: string;
  headingColor: string;
  subColor: string;
  mutedColor: string;
}

function EntryRow({
  entry,
  protocolRisk,
  onEdit,
  onHistoryClick,
  isLight,
  cardBg,
  headingColor,
  subColor,
  mutedColor,
}: EntryRowProps) {
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';

  return (
    <div className={`${cardBg} border rounded-lg p-4`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`${headingColor} text-sm font-semibold`}>
              {entry.vendor_domain}
            </span>
            <ImpactChip impact={entry.provisional_impact} isLight={isLight} />
            <ClassificationChip
              classification={entry.provisional_classification}
              isLight={isLight}
            />
            {entry.risk_context_outdated && <RiskOutdatedChip isLight={isLight} />}
            <HeatIndicator
              score={scoreWorkspaceEntry(entry)}
              variant="chip"
              hint="across similar audits"
            />
          </div>
          {protocolRisk && (
            <div className={`flex items-center gap-1.5 mt-1 text-[11px] ${subColor}`}>
              <Link2 size={11} />
              <span className="font-mono">{protocolRisk.section_identifier}</span>
              <span className={mutedColor}>—</span>
              <span className="truncate">{protocolRisk.section_title}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className={`flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
        >
          <Pencil size={12} />
          Edit
        </button>
      </div>

      {/* Observation text */}
      <p className={`${headingColor} text-sm leading-relaxed mt-2`}>{entry.observation_text}</p>

      {/* Footer: checkpoint, history, attribution */}
      <div className={`flex items-center gap-3 mt-3 flex-wrap text-[11px] ${mutedColor}`}>
        {entry.checkpoint_ref && (
          <span className="font-mono">{entry.checkpoint_ref}</span>
        )}
        <span>Recorded by {entry.created_by_name} · {formatTimestamp(entry.created_at)}</span>
        <button
          type="button"
          className={`inline-flex items-center gap-1 ${subColor} hover:underline`}
          title="Change history"
          onClick={onHistoryClick}
        >
          <HistoryIcon size={11} />
          History
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// EntryCounts (small summary chip cluster)
// ============================================================================

function EntryCounts({
  entries,
  isLight,
}: {
  entries: MockWorkspaceEntry[];
  isLight: boolean;
}) {
  const counts = entries.reduce(
    (acc, e) => {
      if (e.provisional_classification === 'FINDING') acc.findings++;
      else if (e.provisional_classification === 'OBSERVATION') acc.observations++;
      else if (e.provisional_classification === 'OPPORTUNITY_FOR_IMPROVEMENT') acc.ofis++;
      else acc.unclassified++;
      return acc;
    },
    { findings: 0, observations: 0, ofis: 0, unclassified: 0 },
  );

  const subColor = 'text-fg-sub';
  const headingColor = 'text-fg-heading';

  return (
    <div className={`text-xs flex items-center gap-2 flex-wrap ${subColor}`}>
      <span>
        Findings: <span className={headingColor}>{counts.findings}</span>
      </span>
      <span>·</span>
      <span>
        Observations: <span className={headingColor}>{counts.observations}</span>
      </span>
      <span>·</span>
      <span>
        OFIs: <span className={headingColor}>{counts.ofis}</span>
      </span>
      {counts.unclassified > 0 && (
        <>
          <span>·</span>
          <span>
            Not classified: <span className={headingColor}>{counts.unclassified}</span>
          </span>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Chips
// ============================================================================

function ImpactChip({ impact, isLight }: { impact: ProvisionalImpact; isLight: boolean }) {
  const tones: Record<ProvisionalImpact, string> = {
    CRITICAL: isLight
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-red-500/15 border-red-500/30 text-red-300',
    MAJOR: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    MINOR: isLight
      ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]'
      : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
    OBSERVATION: isLight
      ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]'
      : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
    NONE: isLight
      ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/65'
      : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/55',
  };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tones[impact]}`}
    >
      {PROVISIONAL_IMPACT_LABELS[impact]}
    </span>
  );
}

function ClassificationChip({
  classification,
  isLight,
}: {
  classification: ProvisionalClassification;
  isLight: boolean;
}) {
  const tones: Record<ProvisionalClassification, string> = {
    FINDING: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    OBSERVATION: isLight
      ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25 text-[#4a6fa5]'
      : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/30 text-[#6e8fb5]',
    OPPORTUNITY_FOR_IMPROVEMENT: isLight
      ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/65'
      : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/55',
    NOT_YET_CLASSIFIED: isLight
      ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/55'
      : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/45',
  };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${tones[classification]}`}
    >
      {PROVISIONAL_CLASSIFICATION_LABELS[classification]}
    </span>
  );
}

function RiskOutdatedChip({ isLight }: { isLight: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
        isLight
          ? 'bg-amber-50 border-amber-200 text-amber-700'
          : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
      }`}
      title="Linked protocol risk changed via amendment — re-confirm this entry."
    >
      <AlertTriangle size={10} />
      Risk context outdated
    </span>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
