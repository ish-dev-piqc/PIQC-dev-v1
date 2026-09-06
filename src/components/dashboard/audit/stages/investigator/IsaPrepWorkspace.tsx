import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileText,
  History as HistoryIcon,
  Plus,
  RefreshCw,
  Trash2,
  X as XIcon,
} from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import { useAudit } from '../../../../../context/AuditContext';
import { useAuth } from '../../../../../context/AuthContext';
import { AUDIT_TYPE_LABELS, ISA_DOMAIN_LABELS } from '../../../../../lib/audit/labels';
import { formatAuditWindow } from '../../../../../lib/audit/dateWindow';
import { hasReachedStage } from '../../../../../lib/audit/workflowStages';
import { fetchSiteScope, type SiteScope } from '../../../../../lib/audit/siteScopeApi';
import {
  approveDocumentRequest,
  fetchDocumentRequest,
  upsertDocumentRequest,
  type DocumentRequest,
} from '../../../../../lib/audit/documentRequestApi';
import {
  buildDocumentRequestContent,
  groupDocumentRequestItems,
  hasDrift,
  mergeRebuild,
  newAuditorItem,
  requestDrift,
} from '../../../../../lib/audit/documentRequest';
import {
  buildDocumentRequestHtml,
  buildDocumentRequestPlain,
  type DocumentRequestPacket,
} from '../../../../../lib/audit/documentRequestLetter';
import { buildDocumentRequestDocx } from '../../../../../lib/audit/documentRequestDocx';
import type { IsaReportMeta } from '../../../../../lib/audit/isaReportModel';
import type {
  DocumentRequestContent,
  DocumentRequestItem,
  IsaDomain,
} from '../../../../../types/audit';
import StagePreviewNotice from '../../StagePreviewNotice';
import StageTransitionCard from '../StageTransitionCard';
import StatusBadge from '../../deliverables/StatusBadge';
import { useDeliverablePersistence } from '../../deliverables/useDeliverablePersistence';
import { useDeliverableResync } from '../../deliverables/useDeliverableResync';
import HistoryDrawer from '../../HistoryDrawer';
import CriticalityChip from './CriticalityChip';
import { copyRich, downloadBlob } from './isaReportDelivery';

// =============================================================================
// IsaPrepWorkspace — ISA_PREP stage center pane ("Audit prep").
//
// Fourth stage of the Investigator Site Audit workflow: the pre-visit
// document request. Stage 3 built the risk-based scope; this stage turns it
// into the list of documents the auditor asks the site to have ready — a
// baseline every site audit requests plus the standard set of each module in
// the scope (buildDocumentRequestContent: pure, deterministic, no model
// call) — lets the auditor shape it (include / exclude, a note per line,
// lines of their own), records the sampling approach the visit will apply,
// and exports the request letter once approved. The document is the 9th
// deliverable kind on the generic pair (document_request, 20260920000100),
// held behind the house approval latch.
//
// Subjects are selected DURING the audit (the owner's rule as the QA
// auditor). There is no subject sample here: subject-level lines read "for
// the subjects selected during the audit (subject numbers only)" and the
// letter carries a fixed selection paragraph plus the sampling approach.
//
// Editing model: every change lands in a working copy (`draft`) and sets a
// dirty flag; one Save = one upsert = one delta — and one demotion when the
// row was approved (said on the button). Autosave would write a delta per
// tick and demote an approved request on the first checkbox. Rebuild and
// Approve are blocked while dirty. The working copy re-seeds from server
// truth on every new row version (useDeliverableResync) and is protected
// while a save error is pending, so a failed Save keeps the auditor's edits.
//
// Drift: the (domain, criticality) pairs the request was built from versus
// the live scope's modules. Rebuild merges by line key (the auditor's
// includes and notes survive; their own lines are never dropped) and always
// demotes — built_at is content.
//
// Export only from the SAVED row, only while APPROVED, current (no drift),
// clean (no unsaved edits) and without a pending save error. The letter
// shows domain headings only — never the criticality — and no sponsor names.
//
// House preview gate: viewed one ahead (audit still at Scope builder) the
// page shows StagePreviewNotice, the request read-only (inputs disabled), and
// no Build / Rebuild / Approve / Save / Add / export. The Stage 4 → Audit
// conduct card sits below: the transition is ungated server-side ("prep
// deliverables approved" as a gate is ledgered).
// =============================================================================

type LoadState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; scope: SiteScope | null };

interface DocumentRequestBundle {
  document_request: DocumentRequest | null;
}

const DOMAIN_OPTIONS = Object.entries(ISA_DOMAIN_LABELS) as [IsaDomain, string][];

// The one read path — the mount effect and the persistence hook's refresh
// both go through it, so a stale-approve reload re-reads the scope the drift
// notice compares against, not just the row.
async function loadAll(
  auditId: string,
): Promise<{ state: LoadState; request: DocumentRequest | null }> {
  const [scopeRes, requestRes] = await Promise.all([
    fetchSiteScope(auditId),
    fetchDocumentRequest(auditId),
  ]);

  if (scopeRes.kind === 'failed') {
    return { state: { kind: 'error', message: 'the site audit scope could not be read' }, request: null };
  }
  if (requestRes.kind === 'failed') {
    return { state: { kind: 'error', message: 'the saved request could not be read' }, request: null };
  }
  if (scopeRes.kind === 'unavailable' || requestRes.kind === 'unavailable') {
    return { state: { kind: 'unavailable' }, request: null };
  }
  return { state: { kind: 'ready', scope: scopeRes.scope }, request: requestRes.request };
}

function basisLabel(item: DocumentRequestItem): string {
  if (item.basis.kind === 'baseline') return 'Baseline';
  if (item.basis.kind === 'module') return ISA_DOMAIN_LABELS[item.basis.isa_domain];
  return 'Added';
}

export default function IsaPrepWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const { profile } = useAuth();
  const isLight = theme === 'light';

  const auditId = activeAudit?.id ?? '';

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [request, setRequest] = useState<DocumentRequest | null>(null);
  // The working copy of the saved content, and whether it differs from it.
  // A flag, never a JSON comparison: jsonb re-orders object keys server-side.
  const [draft, setDraft] = useState<DocumentRequestContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDomain, setNewDomain] = useState<IsaDomain | ''>('');
  const [exporting, setExporting] = useState<'docx' | 'clipboard' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    savingTabs,
    persistErrors,
    approveErrors,
    staleReloadNotices,
    persistDeliverable,
    dismissSaveError,
  } = useDeliverablePersistence<DocumentRequestBundle>({
    auditId,
    setField: (_key, value) => setRequest(value),
    refresh: refreshFromServer,
    logTag: 'IsaPrepWorkspace',
  });

  const saveError = persistErrors[auditId]?.document_request ?? null;

  // Working copy ← server truth on every new row version; skipped while a
  // save error protects the auditor's edits. The editor is always open, so
  // there is nothing to force back into edit mode after a failed save.
  useDeliverableResync({
    deliverable: request,
    saveError,
    syncFromServer: () => {
      setDraft(request?.content ?? null);
      setDirty(false);
    },
    forceEdit: () => {},
  });

  // THE refetch path (hook contract: never throws; false = refresh failed,
  // and the page keeps what it had).
  async function refreshFromServer(): Promise<boolean> {
    const loaded = await loadAll(auditId);
    if (loaded.state.kind !== 'ready') return false;
    setState(loaded.state);
    setRequest(loaded.request);
    return true;
  }

  useEffect(() => {
    if (!auditId) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    void loadAll(auditId).then((loaded) => {
      if (cancelled) return;
      setState(loaded.state);
      if (loaded.state.kind === 'ready') setRequest(loaded.request);
    });
    return () => {
      cancelled = true;
    };
  }, [auditId, reloadNonce]);

  if (!activeAudit) return null;

  const hasReached = hasReachedStage(
    activeAudit.workflow_type,
    activeAudit.current_stage,
    'ISA_PREP',
  );

  const approveError = approveErrors.document_request ?? null;
  const staleNotice = staleReloadNotices.document_request ?? null;
  const saving = savingTabs.document_request === true;
  const approved = request?.approval_status === 'APPROVED';
  const canEdit = hasReached && !saving;

  const scope = state.kind === 'ready' ? state.scope : null;
  const scopeModuleCount = scope?.content.modules.length ?? 0;
  // Drift is judged on the SAVED request, never the working copy.
  const drift = request ? requestDrift(request.content, scope?.content.modules ?? []) : null;
  const drifted = !!drift && hasDrift(drift);
  // approved_at as well as the status: during the optimistic window after an
  // Approve click the status flips first, and a letter needs the seal's date.
  const current = approved && !!request?.approved_at && !drifted && !dirty && !saveError;

  const groups = draft ? groupDocumentRequestItems(draft, false) : [];
  const totalCount = draft?.items.length ?? 0;
  const includedCount = draft?.items.filter((item) => item.included).length ?? 0;
  const builtModuleCount = request?.content.built_from.scope_modules.length ?? 0;

  const meta: IsaReportMeta = {
    auditeeName: activeAudit.auditee_name || 'Investigator site',
    siteNumber: activeAudit.site_number,
    principalInvestigator: activeAudit.principal_investigator,
    siteCountry: activeAudit.site_country,
    protocolCode: activeAudit.protocol_code || null,
    protocolTitle: activeAudit.protocol_title || null,
    auditTypeLabel: AUDIT_TYPE_LABELS[activeAudit.audit_type],
    auditDate: formatAuditWindow(activeAudit.scheduled_date, activeAudit.scheduled_end_date),
    generatedAt: new Date(),
  };

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  const build = () => {
    if (!scope || saving || dirty) return;
    const prev = request;
    const fresh = buildDocumentRequestContent(scope, new Date().toISOString());
    const n = scope.content.modules.length;
    const next: DocumentRequest = {
      id: prev?.id ?? `document-request-${Date.now()}`,
      audit_id: auditId,
      content: prev ? mergeRebuild(prev.content, fresh) : fresh,
      approval_status: 'DRAFT',
      approved_at: null,
      approved_by_name: null,
      updated_at: prev?.updated_at ?? new Date(0).toISOString(),
    };
    const reason = `Document request ${prev ? 'rebuilt' : 'built'} from ${n} scope module${n === 1 ? '' : 's'}`;
    setRequest(next);
    void persistDeliverable('document_request', 'DocumentRequest', prev, next, {
      upsert: (row) => upsertDocumentRequest(auditId, row.content, reason),
      // Unreachable from a build (next stays DRAFT — no approval transition);
      // present to satisfy the ops contract.
      approve: (p) => approveDocumentRequest(p.id, p.updated_at),
    });
  };

  const saveDraft = () => {
    if (!request || !draft || saving) return;
    const prev = request;
    // Any content change demotes server-side; say so in the cache too, so
    // the badge and the export row never show an approval the save is about
    // to revoke.
    const next: DocumentRequest = {
      ...prev,
      content: draft,
      approval_status: 'DRAFT',
      approved_at: null,
      approved_by_name: null,
    };
    setRequest(next);
    void persistDeliverable('document_request', 'DocumentRequest', prev, next, {
      upsert: (row) => upsertDocumentRequest(auditId, row.content, 'Document request edited'),
      approve: (p) => approveDocumentRequest(p.id, p.updated_at),
    });
  };

  const discardDraft = () => {
    dismissSaveError('document_request');
    setDraft(request?.content ?? null);
    setDirty(false);
  };

  const approveNow = () => {
    if (!request || saving || saveError || dirty || drifted) return;
    const next: DocumentRequest = { ...request, approval_status: 'APPROVED' };
    setRequest(next);
    void persistDeliverable('document_request', 'DocumentRequest', request, next, {
      upsert: (row) => upsertDocumentRequest(auditId, row.content),
      approve: (p) => approveDocumentRequest(p.id, p.updated_at),
    });
  };

  const editDraft = (fn: (d: DocumentRequestContent) => DocumentRequestContent) => {
    setDraft((d) => (d ? fn(d) : d));
    setDirty(true);
  };
  const toggleItem = (key: string) =>
    editDraft((d) => ({
      ...d,
      items: d.items.map((item) => (item.key === key ? { ...item, included: !item.included } : item)),
    }));
  const setItemNote = (key: string, note: string) =>
    editDraft((d) => ({
      ...d,
      items: d.items.map((item) => (item.key === key ? { ...item, note } : item)),
    }));
  const removeItem = (key: string) =>
    editDraft((d) => ({ ...d, items: d.items.filter((item) => item.key !== key) }));
  const addItem = () => {
    const title = newTitle.trim();
    if (!title) return;
    editDraft((d) => ({ ...d, items: [...d.items, newAuditorItem(d.items, title, newDomain || null)] }));
    setNewTitle('');
    setNewDomain('');
  };

  // ---------------------------------------------------------------------------
  // Export — from the SAVED row, never the working copy
  // ---------------------------------------------------------------------------
  const packetFromSaved = (): DocumentRequestPacket | null => {
    if (!request?.approved_at) return null;
    return {
      meta,
      content: request.content,
      approvedByName: request.approved_by_name,
      approvedAt: request.approved_at,
      signatoryName: profile?.name ?? null,
    };
  };

  const exportDocx = async () => {
    const packet = packetFromSaved();
    if (!packet || !current || exporting) return;
    setExporting('docx');
    setExportError(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(
        await buildDocumentRequestDocx(packet),
        `${meta.protocolCode ?? 'isa'}_document_request_${stamp}.docx`,
      );
    } catch (err) {
      setExportError(`Couldn’t build the letter: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  };

  const exportClipboard = async () => {
    const packet = packetFromSaved();
    if (!packet || !current || exporting) return;
    setExporting('clipboard');
    setExportError(null);
    try {
      if (await copyRich(buildDocumentRequestHtml(packet), buildDocumentRequestPlain(packet))) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        setExportError('Copy failed — your browser blocked clipboard access.');
      }
    } finally {
      setExporting(null);
    }
  };

  const exportBlockedReason = dirty
    ? 'Save your changes and approve the request first.'
    : !approved
    ? 'Approve the request to enable the letter.'
    : drifted
    ? 'The scope changed since this request was built — rebuild and approve again.'
    : saveError
    ? 'Resolve the failed save first.'
    : null;

  // ---------------------------------------------------------------------------
  // Theme tokens (the ISA stage palette)
  // ---------------------------------------------------------------------------
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const rowBg = isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-white/[0.02] border-white/5';
  const basisChip = isLight ? 'bg-[#F2F2F2] text-brand-600' : 'bg-white/[0.06] text-brand-300';
  const inputBase = isLight
    ? 'bg-white border-[#E2E8F0] focus:border-brand-600/50 text-fg-body'
    : 'bg-white/[0.03] border-white/10 focus:border-brand-300/50 text-fg-body';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-[#CBD5E1]'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-white/10 disabled:text-white/35';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-[#CBD5E1]'
    : 'bg-emerald-500 text-[#020617] hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/35';
  const amberBox = isLight
    ? 'bg-amber-50 border-amber-200 text-amber-700'
    : 'bg-amber-500/15 border-amber-500/30 text-amber-300';
  const redBox = isLight
    ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-red-500/15 border-red-500/30 text-red-300';
  const emeraldBox = isLight
    ? 'bg-emerald-50 border-emerald-200'
    : 'bg-emerald-500/10 border-emerald-500/30';

  return (
    // Container + type scale match the sibling ISA stages (p-6 max-w-4xl,
    // text-xl heading).
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {!hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}

      {/* Header */}
      <div>
        <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          Stage 4 · Audit prep
        </p>
        <h2 className="text-fg-heading text-xl font-semibold mt-1">
          Request documents and set the sampling approach
        </h2>
        <p className="text-fg-sub text-sm mt-1.5 leading-relaxed max-w-2xl">
          The request is derived from the site audit scope: a baseline every site audit asks for,
          plus the standard documents of each module in scope. Include, exclude or annotate any
          line, add your own, and state how subjects will be selected on site. Nothing is written
          by a model. Approving pins this version; the request letter exports from an approved,
          current request.
        </p>
      </div>

      <section className={`${cardBg} border rounded-xl p-5`}>
        <div className="flex items-start gap-2">
          <FileText size={15} className={`flex-shrink-0 mt-0.5 ${isLight ? 'text-brand-600' : 'text-brand-300'}`} />
          <div className="min-w-0 flex-1">
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              Document request
            </p>
            <h3 className="text-fg-heading text-sm font-semibold mt-1">
              Documents to request from {activeAudit.auditee_name || 'this site'}
            </h3>
          </div>
          {request && state.kind === 'ready' && <StatusBadge approved={approved} isLight={isLight} />}
        </div>

        <div className="mt-4 space-y-3">
          {state.kind === 'loading' && (
            <p className="text-fg-sub text-sm">Loading the document request…</p>
          )}

          {state.kind === 'unavailable' && (
            <p className="text-fg-sub text-sm">
              Audit prep isn’t available in this environment yet.
            </p>
          )}

          {state.kind === 'error' && (
            <div role="alert" className={`text-xs px-3 py-2 rounded-md border ${redBox}`}>
              Couldn’t load the document request: {state.message}
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="ml-2 underline font-medium"
              >
                Retry
              </button>
            </div>
          )}

          {state.kind === 'ready' && !scope && (
            <p className="text-fg-sub text-sm">
              Build the site audit scope on Scope builder first.
            </p>
          )}

          {state.kind === 'ready' && scope && !request && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-fg-sub text-sm">
                No request built yet. {scopeModuleCount} module{scopeModuleCount === 1 ? '' : 's'} in scope.
              </p>
              {hasReached && (
                <button
                  type="button"
                  onClick={build}
                  disabled={saving}
                  className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary}`}
                >
                  <FileText size={14} />
                  {saving ? 'Building…' : 'Build request'}
                </button>
              )}
            </div>
          )}

          {state.kind === 'ready' && request && draft && (
            <>
              <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                {includedCount} of {totalCount} document{totalCount === 1 ? '' : 's'} requested ·{' '}
                {builtModuleCount} module{builtModuleCount === 1 ? '' : 's'}
                {request.content.built_from.built_at
                  ? ` · built ${new Date(request.content.built_from.built_at).toLocaleDateString()}`
                  : ''}
              </p>

              {drifted && drift && (
                <div
                  role="status"
                  className={`flex items-start gap-2 px-3 py-2 rounded-md border ${amberBox}`}
                >
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed flex-1">
                    <span className="font-semibold">
                      {drift.added} module{drift.added === 1 ? '' : 's'} added, {drift.removed} removed and{' '}
                      {drift.changed} changed criticality on Scope builder since this request was built.
                    </span>{' '}
                    Rebuild to bring the request up to date
                    {approved ? ' — rebuilding reverts approval to Draft.' : '.'}
                  </p>
                  {hasReached && (
                    <button
                      type="button"
                      onClick={build}
                      disabled={saving || dirty || !scope}
                      title={
                        !scope
                          ? 'Build the site audit scope on Scope builder first'
                          : dirty
                          ? 'Save or discard your changes first'
                          : undefined
                      }
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
                    >
                      <RefreshCw size={12} />
                      Rebuild request
                    </button>
                  )}
                </div>
              )}

              {staleNotice && (
                <div className={`px-3 py-2 rounded-md border text-xs leading-relaxed ${amberBox}`}>
                  {staleNotice}
                </div>
              )}
              {approveError && (
                <div role="alert" className={`px-3 py-2 rounded-md border text-xs leading-relaxed ${redBox}`}>
                  {approveError}
                </div>
              )}

              {/* Letter fields */}
              <div className={`${rowBg} border rounded-lg px-4 py-3 space-y-3`}>
                <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                  Request letter
                </p>
                <div>
                  <p className="text-fg-sub text-xs font-medium">Sampling approach</p>
                  <textarea
                    value={draft.sampling_approach}
                    onChange={(e) => editDraft((d) => ({ ...d, sampling_approach: e.target.value }))}
                    disabled={!canEdit}
                    rows={3}
                    aria-label="Sampling approach"
                    className={`mt-1 w-full text-xs leading-relaxed rounded-md border px-2.5 py-2 outline-none disabled:opacity-60 ${inputBase}`}
                  />
                  <p className="text-fg-muted text-[11px] mt-1">
                    Stated in the letter after the fixed subject-level paragraph. Subjects are selected
                    during the audit, never before.
                  </p>
                </div>
                <div>
                  <p className="text-fg-sub text-xs font-medium">Delivery instructions</p>
                  <textarea
                    value={draft.instructions}
                    onChange={(e) => editDraft((d) => ({ ...d, instructions: e.target.value }))}
                    disabled={!canEdit}
                    rows={2}
                    aria-label="Delivery instructions"
                    placeholder="Where and how the site should make the documents available (optional)"
                    className={`mt-1 w-full text-xs leading-relaxed rounded-md border px-2.5 py-2 outline-none disabled:opacity-60 ${inputBase}`}
                  />
                </div>
              </div>

              {groups.map((group) => {
                const groupIncluded = group.items.filter((item) => item.included).length;
                return (
                  <div key={group.key} className={`${rowBg} border rounded-lg px-4 py-3`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-fg-heading text-sm font-semibold">{group.heading}</h4>
                      {group.criticality && (
                        <CriticalityChip criticality={group.criticality} isLight={isLight} />
                      )}
                      <span className="text-fg-muted text-xs">
                        {groupIncluded} of {group.items.length} included
                      </span>
                    </div>
                    <ul className="mt-2 space-y-2">
                      {group.items.map((item) => (
                        <li key={item.key} className="flex items-start gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={item.included}
                            disabled={!canEdit}
                            onChange={() => toggleItem(item.key)}
                            aria-label={`Include ${item.title}`}
                            className="mt-0.5 flex-shrink-0"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span
                                className={`font-medium ${item.included ? 'text-fg-body' : 'text-fg-muted line-through'}`}
                              >
                                {item.title}
                              </span>
                              <span
                                className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${basisChip}`}
                              >
                                {basisLabel(item)}
                              </span>
                            </div>
                            {item.detail && <p className="text-fg-muted">{item.detail}</p>}
                            <input
                              type="text"
                              value={item.note}
                              disabled={!canEdit}
                              onChange={(e) => setItemNote(item.key, e.target.value)}
                              placeholder="Note for the site (optional)"
                              aria-label={`Note for ${item.title}`}
                              className={`w-full text-xs rounded-md border px-2 py-1 outline-none disabled:opacity-60 ${inputBase}`}
                            />
                          </div>
                          {canEdit && item.basis.kind === 'auditor' && (
                            <button
                              type="button"
                              onClick={() => removeItem(item.key)}
                              aria-label={`Remove ${item.title}`}
                              className="inline-flex items-center justify-center w-6 h-6 rounded opacity-60 hover:opacity-100 text-fg-sub"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}

              {canEdit && (
                <div className={`${rowBg} border rounded-lg px-4 py-3`}>
                  <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                    Add a document
                  </p>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="Document the site should have ready"
                      aria-label="Document title"
                      className={`flex-1 min-w-[16rem] text-xs rounded-md border px-2.5 py-1.5 outline-none ${inputBase}`}
                    />
                    <select
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value as IsaDomain | '')}
                      aria-label="Module"
                      className={`text-xs rounded-md border px-2 py-1.5 outline-none ${inputBase}`}
                    >
                      <option value="">No module</option>
                      {DOMAIN_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addItem}
                      disabled={!newTitle.trim()}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonSecondary}`}
                    >
                      <Plus size={12} />
                      Add
                    </button>
                  </div>
                </div>
              )}

              {hasReached && dirty && (
                <div
                  role="status"
                  className={`flex items-center gap-2 flex-wrap px-3 py-2 rounded-md border ${amberBox}`}
                >
                  <span className="text-xs font-semibold flex-1">Unsaved changes</span>
                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={saving}
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
                  >
                    {saving
                      ? 'Saving…'
                      : approved
                      ? 'Save changes — reverts approval to Draft'
                      : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    onClick={discardDraft}
                    disabled={saving}
                    className={`inline-flex items-center text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonSecondary}`}
                  >
                    Discard
                  </button>
                </div>
              )}

              {/* Latch row */}
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {approved ? (
                  <span className="text-fg-sub text-xs">
                    Approved
                    {request.approved_at ? ` ${new Date(request.approved_at).toLocaleDateString()}` : ''}
                    {request.approved_by_name ? ` · ${request.approved_by_name}` : ''}
                  </span>
                ) : (
                  hasReached && (
                    <button
                      type="button"
                      onClick={approveNow}
                      // Blocked while a save is in flight, failed, or unsaved
                      // (the cache and the server may disagree — the CAS-latch
                      // hole), and while the scope moved on: approving a stale
                      // request would only lead to "rebuild and approve again".
                      disabled={saving || !!saveError || dirty || drifted}
                      title={
                        dirty
                          ? 'Save or discard your changes first'
                          : drifted
                          ? 'Rebuild first — the scope changed since this request was built'
                          : undefined
                      }
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonApprove}`}
                    >
                      <CheckCircle2 size={12} />
                      Approve request
                    </button>
                  )
                )}
                {hasReached && !drifted && (
                  <button
                    type="button"
                    onClick={build}
                    disabled={saving || dirty || !scope}
                    title={
                      !scope
                        ? 'Build the site audit scope on Scope builder first'
                        : dirty
                        ? 'Save or discard your changes first'
                        : approved
                        ? 'Rebuilding reverts approval to Draft'
                        : undefined
                    }
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonSecondary}`}
                  >
                    <RefreshCw size={12} />
                    Rebuild request
                  </button>
                )}
                {/* !saving: during an in-flight FIRST build the cached row is an
                    optimistic mint whose id the history RPC would reject. */}
                {!saving && (
                  <button
                    type="button"
                    onClick={() => setHistoryOpen(true)}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
                    aria-label="Open change history for the document request"
                  >
                    <HistoryIcon size={12} />
                    History
                  </button>
                )}
              </div>

              {/* Export */}
              {hasReached && (
                <div className={`border rounded-lg px-4 py-3 ${current ? emeraldBox : rowBg}`}>
                  <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                    Request letter export
                  </p>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => void exportDocx()}
                      disabled={!current || exporting !== null}
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
                    >
                      <Download size={13} />
                      {exporting === 'docx' ? 'Exporting…' : 'Download request letter .docx'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void exportClipboard()}
                      disabled={!current || exporting !== null}
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonSecondary}`}
                    >
                      {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
                      {exporting === 'clipboard' ? 'Copying…' : copied ? 'Copied' : 'Copy for Word / Docs'}
                    </button>
                  </div>
                  {exportBlockedReason && (
                    <p className="text-fg-muted text-xs mt-2">{exportBlockedReason}</p>
                  )}
                  {exportError && (
                    <div role="alert" className={`mt-2 px-3 py-2 rounded-md border text-xs ${redBox}`}>
                      {exportError}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {state.kind === 'ready' && saveError && (
            <div
              role="alert"
              className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs leading-relaxed ${redBox}`}
            >
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <p className="flex-1">
                {dirty
                  ? 'Couldn’t save the request — your changes are still here. Save again to retry, or discard them.'
                  : 'Couldn’t save the request — nothing was recorded. Build again to retry.'}
              </p>
              {!dirty && (
                <button
                  type="button"
                  onClick={() => dismissSaveError('document_request')}
                  aria-label="Dismiss the save error"
                  className="inline-flex items-center justify-center w-5 h-5 rounded opacity-70 hover:opacity-100"
                >
                  <XIcon size={11} />
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <StageTransitionCard stage="ISA_PREP" nextStage="ISA_CONDUCT" />

      {historyOpen && request && (
        <HistoryDrawer
          objectType="DOCUMENT_REQUEST_OBJECT"
          objectId={request.id}
          title="Document request"
          subTitle="Audit prep · change history"
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}
