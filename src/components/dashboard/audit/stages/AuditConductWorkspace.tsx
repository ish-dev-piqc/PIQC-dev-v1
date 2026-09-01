import { useState, useEffect } from 'react';
import {
  Plus,
  Pencil,
  AlertTriangle,
  History as HistoryIcon,
  ArrowRight,
  Link2,
  FileSearch,
  X as XIcon,
} from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useAuditData } from '../../../../context/AuditDataContext';
import {
  PROVISIONAL_IMPACT_LABELS,
  PROVISIONAL_CLASSIFICATION_LABELS,
  PROVISIONAL_CLASSIFICATION_ORDER,
} from '../../../../lib/audit/labels';
import { type TaggedSection } from '../../../../lib/audit/mockProtocolRisks';
import { type MockWorkspaceEntry } from '../../../../lib/audit/mockWorkspaceEntries';
import {
  fetchWorkspaceEntries,
  createWorkspaceEntry,
  updateWorkspaceEntry,
} from '../../../../lib/audit/workspaceEntriesApi';
import { fetchVendorNotes } from '../../../../lib/audit/vendorNotesApi';
import HeatIndicator from '../../../heatmap/HeatIndicator';
import { scoreWorkspaceEntry } from '../../../../lib/heatmap';
import type {
  AuditNoteObject,
  ProvisionalClassification,
  ProvisionalImpact,
} from '../../../../types/audit';
import type { ExtractedItemRecord } from '../../../../types/sotr';
import { hasPassedStage, hasReachedStage } from '../../../../lib/audit/workflowStages';
import HistoryDrawer from '../HistoryDrawer';
import StagePreviewNotice from '../StagePreviewNotice';
import VendorNotesPad from './vendor/VendorNotesPad';
import VendorCandidatePanel from './vendor/VendorCandidatePanel';
import EntryProvenance from './vendor/EntryProvenance';
import SourceTruthListDrawer from '../../../sotr/SourceTruthListDrawer';
import SourceTruthDrawer from '../../../sotr/SourceTruthDrawer';
import { formatExtractedValue } from '../../../sotr/WorksheetItemRow';

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
// One order for the entry form and the candidate panel (labels.ts).
const CLASSIFICATION_OPTIONS: ProvisionalClassification[] = [...PROVISIONAL_CLASSIFICATION_ORDER];

interface EntryFormState {
  vendor_domain: string;
  observation_text: string;
  provisional_impact: ProvisionalImpact;
  provisional_classification: ProvisionalClassification;
  checkpoint_ref: string;
  protocol_risk_id: string;
  // B2: optional SOTR protocol_extracted_item link. Label is in-session-only —
  // the row doesn't persist a label; on edit-mode hydrate the id and fall back
  // to a generic "Linked source" display (matches Stage 1 precedent).
  source_extracted_item_id: string | null;
  source_extracted_item_label: string | null;
}

const EMPTY_FORM: EntryFormState = {
  vendor_domain: '',
  observation_text: '',
  provisional_impact: 'NONE',
  provisional_classification: 'NOT_YET_CLASSIFIED',
  checkpoint_ref: '',
  protocol_risk_id: '',
  source_extracted_item_id: null,
  source_extracted_item_label: null,
};

type FormMode = 'list' | 'add' | 'edit';

export default function AuditConductWorkspace() {
  const { theme } = useTheme();
  const { activeAudit, advanceStage, advanceStageError } = useAudit();
  const isLight = theme === 'light';

  // One-ahead preview guard (UX2): Stage 6 is viewable while the audit is
  // still at Stage 5. Observations record what happened during conduct, so
  // creating/editing them — and advancing — waits until the stage is real.
  const hasReached =
    !!activeAudit &&
    hasReachedStage(activeAudit.workflow_type, activeAudit.current_stage, 'AUDIT_CONDUCT');

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
  // AUD-301: surface a save failure instead of silently swallowing the null.
  const [saveError, setSaveError] = useState<string | null>(null);
  // B2 picker state — drawers render at workspace level (z-40/z-50) so they
  // stack correctly over the inline form. Form just emits pick/clear events.
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [viewSourceOpen, setViewSourceOpen] = useState(false);

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

  // Fieldwork notes (vendor lane) — ONE read per audit feeds the notes pad
  // and the candidate panel; both are props-driven. Same hydrate idiom as the
  // entries read above, and keyed by audit like the entries store: the slot
  // names the audit it was read for, so on a switch the stale read is never
  // handed to the next audit's pad or panel. 'failed' is a state, not an
  // empty list — the pad renders it honestly and the panel stays unarmed.
  const [notesState, setNotesState] = useState<{
    auditId: string | null;
    status: 'loading' | 'ready' | 'failed';
    notes: AuditNoteObject[];
  }>({ auditId: null, status: 'loading', notes: [] });
  const [notesReloadNonce, setNotesReloadNonce] = useState(0);
  useEffect(() => {
    if (!activeAudit) return;
    const auditIdLocal = activeAudit.id;
    let cancelled = false;
    setNotesState({ auditId: auditIdLocal, status: 'loading', notes: [] });
    void fetchVendorNotes(auditIdLocal).then((res) => {
      if (cancelled) return;
      setNotesState(
        res.ok
          ? { auditId: auditIdLocal, status: 'ready', notes: res.data }
          : { auditId: auditIdLocal, status: 'failed', notes: [] },
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudit?.id, notesReloadNonce]);

  if (!activeAudit) return null;

  const auditId = activeAudit.id;
  // Between a switch and the effect above, the slot still holds the previous
  // audit's read — that reads as loading here, never as the wrong notes.
  const notesForAudit: { status: 'loading' | 'ready' | 'failed'; notes: AuditNoteObject[] } =
    notesState.auditId === auditId ? notesState : { status: 'loading', notes: [] };
  // The same read feeds each row's provenance chain (slice 3).
  const notesById = new Map(notesForAudit.notes.map((n) => [n.id, n]));
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
      source_extracted_item_id: entry.source_extracted_item_id,
      source_extracted_item_label: null, // not stored on the row; falls back to "Linked source"
    });
    setMode('edit');
  };

  const cancel = () => {
    setMode('list');
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSourcePickerOpen(false);
    setViewSourceOpen(false);
  };

  // B2 — picker callbacks. Drawers live at parent scope (see Decision in
  // EntryForm header comment) and emit results back via these handlers.
  const handlePickSource = (item: ExtractedItemRecord) => {
    setForm((prev) => ({
      ...prev,
      source_extracted_item_id: item.id,
      source_extracted_item_label: formatExtractedValue(item.extracted_value),
    }));
    setSourcePickerOpen(false);
  };
  const handleClearSource = () => {
    setForm((prev) => ({
      ...prev,
      source_extracted_item_id: null,
      source_extracted_item_label: null,
    }));
  };

  // Vendor lane — the pad mutates notes through this; an accepted candidate
  // lands in the shared entry store (the saveEntry merge idiom) and marks
  // the notes it consumed as promoted, so the pad hides their affordances
  // and the next Draft excludes them without a refetch. Bound to THIS
  // audit: a mutation that resolves after a switch (the old pad's closure)
  // is dropped rather than written into the next audit's notes.
  const handleNotesChange = (updater: (prev: AuditNoteObject[]) => AuditNoteObject[]) =>
    setNotesState((s) => (s.auditId === auditId ? { ...s, notes: updater(s.notes) } : s));

  const handleCandidatePromoted = (entry: MockWorkspaceEntry, consumedNoteIds: string[]) => {
    setEntriesByAudit((prev) => ({
      ...prev,
      [auditId]: [...(prev[auditId] ?? []), entry],
    }));
    if (consumedNoteIds.length > 0) {
      const consumed = new Set(consumedNoteIds);
      handleNotesChange((prev) =>
        prev.map((n) => (consumed.has(n.id) ? { ...n, promoted_entry_id: entry.id } : n)),
      );
    }
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
      const result = await createWorkspaceEntry(auditId, {
        vendorDomain: form.vendor_domain.trim(),
        observationText: form.observation_text.trim(),
        provisionalImpact: form.provisional_impact,
        provisionalClassification: form.provisional_classification,
        checkpointRef: checkpointInput || null,
        protocolRiskId: form.protocol_risk_id || null,
        sourceExtractedItemId: form.source_extracted_item_id,
      });
      if (result.ok) {
        setSaveError(null);
        setEntriesByAudit((prev) => ({
          ...prev,
          [auditId]: [...(prev[auditId] ?? []), result.data],
        }));
        cancel();
      } else {
        setSaveError(result.error);
      }
    } else if (mode === 'edit' && editingId) {
      const previous = (entriesByAudit[auditId] ?? []).find((e) => e.id === editingId);
      // Three-way semantics on source_extracted_item_id (mirror of Stage 1):
      //   - was linked, now null     → clear
      //   - is set (changed or same) → set (server is idempotent for same id)
      //   - both null                → unchanged
      const wasLinked = !!previous?.source_extracted_item_id;
      const nowLinked = !!form.source_extracted_item_id;
      const sourceUpdate: {
        sourceExtractedItemId?: string;
        clearSourceExtractedItemId?: boolean;
      } = {};
      if (!nowLinked && wasLinked) {
        sourceUpdate.clearSourceExtractedItemId = true;
      } else if (nowLinked) {
        sourceUpdate.sourceExtractedItemId = form.source_extracted_item_id!;
      }

      const updated = await updateWorkspaceEntry(editingId, {
        vendorDomain: form.vendor_domain.trim(),
        observationText: form.observation_text.trim(),
        provisionalImpact: form.provisional_impact,
        provisionalClassification: form.provisional_classification,
        checkpointRef: checkpointInput || null,
        clearCheckpointRef: !checkpointInput && !!previous?.checkpoint_ref,
        ...sourceUpdate,
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
  const canSave = !!form.vendor_domain.trim() && !!form.observation_text.trim();

  const alreadyAdvanced = hasPassedStage(
    activeAudit.workflow_type,
    activeAudit.current_stage,
    'AUDIT_CONDUCT',
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {!hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}
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
        {!inForm && hasReached && (
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

      {/* Fieldwork notes pad (vendor lane, slice 1) — working papers that
          feed slice 2's candidate drafting; never the observation record. */}
      <VendorNotesPad
        key={activeAudit.id}
        auditId={activeAudit.id}
        hasReached={hasReached}
        isLight={isLight}
        notes={notesForAudit.notes}
        status={notesForAudit.status}
        onRetry={() => setNotesReloadNonce((n) => n + 1)}
        onNotesChange={handleNotesChange}
      />

      {/* Inline form */}
      {inForm && (
        <div className={`${formCardBg} border rounded-xl p-5`}>
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold mb-4`}>
            {mode === 'add' ? 'New observation' : 'Edit observation'}
          </p>
          {saveError && (
            <div
              role="alert"
              className={`text-xs px-3 py-2 mb-4 rounded-md border ${
                isLight
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-red-500/15 border-red-500/30 text-red-300'
              }`}
            >
              Couldn’t save this entry: {saveError}
            </div>
          )}
          <EntryForm
            form={form}
            onChange={setForm}
            protocolRisks={auditProtocolRisks}
            isLight={isLight}
            hasProtocol={!!activeAudit.protocol_id}
            onOpenSourcePicker={() => setSourcePickerOpen(true)}
            onOpenViewSource={() => setViewSourceOpen(true)}
            onClearSource={handleClearSource}
          />
          <div className={`flex items-center gap-2 pt-4 mt-4 border-t ${isLight ? 'border-[#E2E8F0]' : 'border-white/5'}`}>
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
                  ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                  : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]'
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
            {hasReached ? (
              <>
                No observations recorded yet. Use{' '}
                <span className={`${headingColor} font-medium`}>New entry</span> to capture the
                first observation.
              </>
            ) : (
              // Preview: don't point at the hidden New-entry button.
              'No observations recorded yet. Observations are captured once the audit reaches this stage.'
            )}
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
                previewLocked={!hasReached}
                onHistoryClick={() => setHistoryTarget({ objectId: e.id })}
                notesById={notesById}
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

      {/* PIQC-drafted candidate observations (vendor lane, slice 2) —
          proposals only; Accept is the single path into the record above.
          Stays mounted while the entry form is open so an in-flight draft
          is not lost to a "New entry" click. */}
      <VendorCandidatePanel
        key={`candidates-${activeAudit.id}`}
        auditId={activeAudit.id}
        hasReached={hasReached}
        isLight={isLight}
        notes={notesForAudit.notes}
        notesStatus={notesForAudit.status}
        onPromoted={handleCandidatePromoted}
      />

      {historyTarget && (
        <HistoryDrawer
          objectType="AUDIT_WORKSPACE_ENTRY_OBJECT"
          objectId={historyTarget.objectId}
          title="Workspace entry"
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {/* B2 — protocol source picker. Opens in pick-mode (Attach button on
          each parsed item). Hidden when the audit has no protocol_id (the
          picker would have nothing to read from). z-40 list / z-50 per-item
          mirrors the Stage 1 picker stacking. */}
      {sourcePickerOpen && activeAudit.protocol_id && (
        <SourceTruthListDrawer
          studyId={activeAudit.protocol_id}
          studyCode={activeAudit.protocol_code ?? null}
          onClose={() => setSourcePickerOpen(false)}
          onPick={handlePickSource}
        />
      )}

      {/* View-only drawer for the currently linked source item. */}
      {viewSourceOpen && form.source_extracted_item_id && activeAudit.protocol_id && (
        <SourceTruthDrawer
          studyId={activeAudit.protocol_id}
          worksheetItemId={form.source_extracted_item_id}
          itemLabel={form.source_extracted_item_label ?? 'Linked source'}
          onClose={() => setViewSourceOpen(false)}
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
                : !hasReached
                ? 'Advancing unlocks when the audit reaches this stage'
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
            disabled={entries.length === 0 || alreadyAdvanced || !hasReached}
            className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${
              isLight
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-[#CBD5E1]'
                : 'bg-emerald-500 text-[#020617] hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/35'
            }`}
          >
            Advance to Report drafting
            <ArrowRight size={14} />
          </button>
        </div>
        {/* Server-side gate rejection surfaced from AuditContext.advanceStage.
            Without this the click is silently lost (AUD-301 class). */}
        {advanceStageError && (
          <div
            role="alert"
            className={`text-xs px-3 py-2 mt-4 rounded-md border ${
              isLight
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-red-500/15 border-red-500/30 text-red-300'
            }`}
          >
            Couldn’t advance the stage: {advanceStageError}
          </div>
        )}
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
  /** Whether the audit has a protocol — if not, the source-link picker is
   *  hidden (the picker would have nothing to read from). */
  hasProtocol: boolean;
  onOpenSourcePicker: () => void;
  onOpenViewSource: () => void;
  onClearSource: () => void;
}

function EntryForm({
  form,
  onChange,
  protocolRisks,
  isLight,
  hasProtocol,
  onOpenSourcePicker,
  onOpenViewSource,
  onClearSource,
}: EntryFormProps) {
  const labelColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const headingColor = 'text-fg-heading';
  const inputBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const inputBorder = isLight
    ? 'border-[#CBD5E1] focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
    : 'border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30';
  const radioActive = isLight
    ? 'bg-brand-600/10 border-brand-600 text-brand-600'
    : 'bg-brand-600/15 border-brand-300 text-brand-300';
  const radioInactive = isLight
    ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:border-[#CBD5E1] hover:text-[#0F172A]'
    : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]/55 hover:border-white/20 hover:text-[#CBD5E1]';

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

      {/* Protocol source link (optional) — Stage 6 is capture-time, not
          decision-time, so the picker is visually subordinate: compact chip
          when linked, quiet dashed affordance when unlinked. No explanatory
          copy — keeps the form tempo fast. Eye should be able to skip past
          this without effort. */}
      {hasProtocol && (
        <div>
          {form.source_extracted_item_id ? (
            <div
              data-testid="conduct-source-link-chip"
              className={`flex items-center gap-2 flex-wrap rounded-md border px-2.5 py-1.5 ${
                isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10'
              }`}
            >
              <Link2 size={11} className={mutedColor} />
              <span className={`${subColor} text-[11px] flex-1 min-w-0 truncate`}>
                Linked source ·{' '}
                <span className={headingColor}>
                  {form.source_extracted_item_label ?? 'protocol item'}
                </span>
              </span>
              <button
                type="button"
                onClick={onOpenViewSource}
                className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded transition-colors ${
                  isLight
                    ? 'text-[#334155]/75 hover:bg-[#F8FAFC]'
                    : 'text-[#CBD5E1]/70 hover:bg-white/[0.04]'
                }`}
              >
                <FileSearch size={10} />
                View
              </button>
              <button
                type="button"
                onClick={onClearSource}
                aria-label="Remove protocol source link"
                className={`inline-flex items-center justify-center w-5 h-5 rounded transition-colors ${
                  isLight
                    ? 'text-[#334155]/55 hover:bg-[#F8FAFC]'
                    : 'text-[#CBD5E1]/55 hover:bg-white/[0.04]'
                }`}
              >
                <XIcon size={10} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="conduct-source-link-picker-button"
              onClick={onOpenSourcePicker}
              className={`inline-flex items-center gap-1.5 text-[11px] rounded-md border border-dashed px-2.5 py-1 transition-colors ${
                isLight
                  ? 'border-[#CBD5E1] hover:border-brand-600/40 hover:bg-[#F8FAFC] text-[#334155]/70'
                  : 'border-white/15 hover:border-brand-300/40 hover:bg-white/[0.03] text-[#CBD5E1]/60'
              }`}
            >
              <FileSearch size={11} />
              Link to protocol source…
            </button>
          )}
        </div>
      )}

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
          Freetext — cite the vendor SOP or section you observed on-site (PIQC does not parse SOPs).
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
  /** One-ahead preview (UX2): hide the edit affordance, keep the record readable. */
  previewLocked: boolean;
  onHistoryClick: () => void;
  /** The workspace's notes read, for the provenance chain of an accepted candidate. */
  notesById: Map<string, AuditNoteObject>;
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
  previewLocked,
  onHistoryClick,
  notesById,
  isLight,
  cardBg,
  headingColor,
  subColor,
  mutedColor,
}: EntryRowProps) {
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';

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
        {!previewLocked && (
          <button
            type="button"
            onClick={onEdit}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
          >
            <Pencil size={12} />
            Edit
          </button>
        )}
      </div>

      {/* Observation text */}
      <p className={`${headingColor} text-sm leading-relaxed mt-2`}>{entry.observation_text}</p>

      {/* Provenance (fieldwork lane, slice 3) — renders nothing for a
          hand-typed entry. */}
      <EntryProvenance entry={entry} notesById={notesById} isLight={isLight} />

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
  isLight: _isLight,
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
      ? 'bg-brand-600/10 border-brand-600/25 text-brand-600'
      : 'bg-brand-300/15 border-brand-300/30 text-brand-300',
    OBSERVATION: isLight
      ? 'bg-brand-600/10 border-brand-600/25 text-brand-600'
      : 'bg-brand-300/15 border-brand-300/30 text-brand-300',
    NONE: isLight
      ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/65'
      : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/55',
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
      ? 'bg-brand-600/10 border-brand-600/25 text-brand-600'
      : 'bg-brand-300/15 border-brand-300/30 text-brand-300',
    OPPORTUNITY_FOR_IMPROVEMENT: isLight
      ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/65'
      : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/55',
    NOT_YET_CLASSIFIED: isLight
      ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/55'
      : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/45',
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
