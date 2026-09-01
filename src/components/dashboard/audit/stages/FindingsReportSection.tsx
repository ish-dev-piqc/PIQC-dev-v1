import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  History as HistoryIcon,
  Pencil,
  X as XIcon,
} from 'lucide-react';
import {
  approveFindingsReport,
  fetchEntrySetDigest,
  fetchFindingsReport,
  upsertFindingsReport,
  type FindingsReport,
} from '../../../../lib/audit/findingsReport';
import { listAuditEvidence } from '../../../../lib/audit/evidenceApi';
import { fetchWorkspaceEntries } from '../../../../lib/audit/workspaceEntriesApi';
import {
  buildObservationGroups,
  type ReportClassification,
} from '../../../../lib/audit/observationGroups';
import type { MockWorkspaceEntry } from '../../../../lib/audit/mockWorkspaceEntries';
import type { AuditEvidenceListRow } from '../../../../types/audit';
import DeliverableGenerationPanel from '../deliverables/DeliverableGenerationPanel';
import { useDeliverablePersistence } from '../deliverables/useDeliverablePersistence';
import { useDeliverableGeneration } from '../deliverables/useDeliverableGeneration';
import { useDeliverableResync } from '../deliverables/useDeliverableResync';
import HistoryDrawer from '../HistoryDrawer';

// =============================================================================
// FindingsReportSection — the findings report deliverable (PR-D4), rendered
// as a section of Stage-7 ReportDraftingWorkspace. Mount with key={auditId}:
// all state here is audit-scoped and resets by remount.
//
// The document = model-draftable connective narrative (intro/closing, stored)
// around the observation blocks (derived LIVE from the Stage-6 entries prop —
// never stored, never model-round-tripped; this component injects them).
// The QA-placeholder line below each block is code-owned: in-PIQC
// classifications are provisional; final classification is a sponsor-QA
// determination outside PIQC.
//
// Latch honesty across the stored/derived split: Approve requires the live
// entry-set digest fetched from the server and passes it as the basis pin —
// digest unknown (fetch failed) means Approve stays blocked, because an
// approval that can't name which entry set it covered is the dishonest latch
// this kind exists to prevent. After approval, live digest ≠ sealed digest
// renders the divergence banner.
//
// First consumer of the extracted deliverable workbench with a bundle other
// than Stage 5's: the persistence hook is instantiated over a one-key bundle.
// =============================================================================

// Document-casing group headings (Title Case) — deliberately different from
// the Stage-7 screen's sentence case; this section previews a DOCUMENT, and
// the Stage-8 exports of it will share this casing. See observationGroups.ts.
const DOCUMENT_GROUP_LABELS: Record<ReportClassification, string> = {
  FINDING: 'Findings',
  OBSERVATION: 'Observations',
  OPPORTUNITY_FOR_IMPROVEMENT: 'Opportunities for Improvement',
};

// Code-owned template line rendered under every observation block. Never
// model-generated; never stored. See the plan's binding decision 2.
const QA_PLACEHOLDER = 'Final classification: [Classification: to be determined by QA]';

// md5('') — what audit_mode_entry_set_digest returns for a ZERO-entry audit
// (its string_agg COALESCEs to ''). Lets the client detect the one basis
// inconsistency it can see: blocks rendered from an empty entry read while
// the server digest names a non-empty set (stale/failed entries read), or
// vice versa. Approving in that state would seal a pin over blocks the
// reviewer never saw — the exact dishonest latch the pin exists to prevent.
const EMPTY_SET_DIGEST = 'd41d8cd98f00b204e9800998ecf8427e';

interface FindingsReportBundle {
  findings_report: FindingsReport | null;
}

interface Props {
  auditId: string;
  hasReached: boolean;
  isLight: boolean;
}

export default function FindingsReportSection({ auditId, hasReached, isLight }: Props) {
  const [report, setReport] = useState<FindingsReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Absence ≠ failure: failed means the row state is UNKNOWN — render the
  // retry banner, never a scratch form (a transient read failure must not
  // masquerade as "never drafted").
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  // null = no register data (loading or failed) → the panel renders no
  // currency verdict rather than diffing against [].
  const [evidenceRows, setEvidenceRows] = useState<AuditEvidenceListRow[] | null>(null);
  // null = live entry-set digest unknown → Approve blocked, honestly labeled.
  const [liveDigest, setLiveDigest] = useState<string | null>(null);
  // The blocks' data — fetched HERE, alongside the digest, so what renders
  // and what the pin names come from the same read moment. The context's
  // Stage-6 cache is deliberately NOT used: it is only populated when Stage 6
  // mounts, so a direct Stage-7 load would render zero blocks against a
  // real digest — sealing a pin over blocks the reviewer never saw.
  const [entries, setEntries] = useState<MockWorkspaceEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [draftIntro, setDraftIntro] = useState('');
  const [draftClosing, setDraftClosing] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const {
    savingTabs,
    persistErrors,
    approveErrors,
    staleReloadNotices,
    persistDeliverable,
    dismissSaveError,
  } = useDeliverablePersistence<FindingsReportBundle>({
    auditId,
    setField: (_key, value) => setReport(value),
    refresh: refreshFromServer,
    logTag: 'FindingsReportSection',
  });

  const { generatingTab, generationError, runGeneration } = useDeliverableGeneration({
    auditId,
    hasReached,
    refresh: refreshFromServer,
  });

  // THE refetch path (hook contract: never throws; false = row refresh
  // failed). Row + digest + entries + register together: whenever server
  // truth is re-read, the pin, the blocks it names, and the currency basis
  // are re-read in the same moment — so "the latest are shown" claims after
  // a stale-approve reload are actually true.
  async function refreshFromServer(): Promise<boolean> {
    const [rowFetch, digest, liveEntries, evidence] = await Promise.all([
      fetchFindingsReport(auditId),
      fetchEntrySetDigest(auditId),
      fetchWorkspaceEntries(auditId),
      listAuditEvidence(auditId),
    ]);
    setLiveDigest(digest);
    setEntries(liveEntries);
    if (evidence.ok) setEvidenceRows(evidence.data);
    if (rowFetch.failed) return false;
    setReport(rowFetch.report);
    return true;
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [rowFetch, evidence, digest, liveEntries] = await Promise.all([
        fetchFindingsReport(auditId),
        listAuditEvidence(auditId),
        fetchEntrySetDigest(auditId),
        fetchWorkspaceEntries(auditId),
      ]);
      if (cancelled) return;
      setLoaded(true);
      setLoadFailed(rowFetch.failed);
      if (!rowFetch.failed) setReport(rowFetch.report);
      setEvidenceRows(evidence.ok ? evidence.data : null);
      setLiveDigest(digest);
      setEntries(liveEntries);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [auditId, reloadNonce]);

  const saveError = persistErrors[auditId]?.['findings_report'] ?? null;
  const approveError = approveErrors['findings_report'] ?? null;
  const staleNotice = staleReloadNotices['findings_report'] ?? null;
  const saving = savingTabs['findings_report'] === true;
  const generating = generatingTab === 'findings_report';

  // Exit edit mode and re-seed the editors from the cached row — the one
  // draft-reset, shared by resync, Cancel, and save-error discard.
  const resetDrafts = () => {
    setEditing(false);
    setDraftIntro(report?.content.intro_text ?? '');
    setDraftClosing(report?.content.closing_text ?? '');
  };

  useDeliverableResync({
    deliverable: report,
    saveError,
    syncFromServer: resetDrafts,
    forceEdit: () => setEditing(true),
  });

  const upsertOp = (n: FindingsReport) => upsertFindingsReport(auditId, n.content);

  const save = () => {
    const prev = report;
    const next: FindingsReport = {
      id: prev?.id ?? `findings-report-${Date.now()}`,
      audit_id: auditId,
      content: { intro_text: draftIntro.trim(), closing_text: draftClosing.trim() },
      approval_status: 'DRAFT',
      approved_at: null,
      approved_by_name: null,
      updated_at: prev?.updated_at ?? new Date(0).toISOString(),
      basis_digest: null,
      generation_refs: prev?.generation_refs ?? null,
      grounding_snapshot: prev?.grounding_snapshot ?? null,
      generated_at: prev?.generated_at ?? null,
    };
    setReport(next);
    setEditing(false);
    void persistDeliverable('findings_report', 'FindingsReport', prev, next, {
      upsert: upsertOp,
      // Unreachable from a save (next stays DRAFT — no approval transition);
      // present to satisfy the ops contract without a phantom digest.
      approve: (p) => approveFindingsReport(p.id, p.updated_at, liveDigest ?? ''),
    });
  };

  // Derived early: approve must refuse while the rendered blocks and the
  // server digest disagree about even set-emptiness (a failed/stale entries
  // read renders no blocks while the digest names a real set — sealing there
  // would pin blocks the reviewer never saw).
  const emptyMismatch =
    liveDigest !== null && (entries.length === 0) !== (liveDigest === EMPTY_SET_DIGEST);

  const approveNow = () => {
    const digest = liveDigest;
    if (!report || digest === null || emptyMismatch || saving || saveError) return;
    const next: FindingsReport = { ...report, approval_status: 'APPROVED' };
    setReport(next);
    void persistDeliverable('findings_report', 'FindingsReport', report, next, {
      upsert: upsertOp,
      approve: (p) => approveFindingsReport(p.id, p.updated_at, digest),
    });
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const approved = report?.approval_status === 'APPROVED';
  const observationGroups = buildObservationGroups(entries);
  const unclassifiedCount = entries.filter(
    (e) => e.provisional_classification === 'NOT_YET_CLASSIFIED',
  ).length;
  // Post-approval divergence: the sealed basis no longer matches the live
  // entry set. Both sides must be known — an unknown live digest is reported
  // as unknown (approve blocked), never as diverged.
  const diverged =
    approved &&
    !!report?.basis_digest &&
    liveDigest !== null &&
    report.basis_digest !== liveDigest;

  // ---------------------------------------------------------------------------
  // Theme tokens (Stage-7 palette)
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const inputBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const inputBorder = isLight
    ? 'border-[#CBD5E1] focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
    : 'border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30';
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <section data-testid="findings-report-section">
      <h3 className={`text-sm font-semibold mb-2 ${sectionHeader}`}>
        <span className="uppercase tracking-wider text-[10px]">Findings report</span>
      </h3>
      <div className="space-y-2">
        <p className={`${subColor} text-xs leading-relaxed max-w-2xl`}>
          The formal hand-off document: your connective narrative around the
          observation blocks. The blocks mirror Stage 6 live — they are never
          stored or AI-drafted, and classifications stay provisional pending QA.
          Optional; it never gates advancing.
        </p>

        {!loaded ? (
          <p className={`${subColor} text-sm italic`}>Loading findings report…</p>
        ) : loadFailed ? (
          // Honest load failure — absence ≠ failure, so no scratch form here.
          <div
            role="alert"
            data-testid="findings-report-load-error"
            className={`flex items-start gap-2 px-3 py-2 rounded-md border ${redBox}`}
          >
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <p className="text-sm leading-relaxed flex-1">
              The findings report could not be loaded — it may exist. Retry
              before drafting from scratch.
            </p>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <DeliverableGenerationPanel
              kind="findings_report"
              noun="findings report"
              deliverable={report}
              evidenceRows={evidenceRows}
              generating={generating}
              editing={editing}
              error={generationError}
              isLight={isLight}
              previewLocked={!hasReached}
              privacyNote="Observation text is never sent to the model — PIQC drafts only the narrative around counts and domains."
              // Under an entries/digest mismatch the axis must read unknowable,
              // not falsely stale against a bad read.
              liveEntries={emptyMismatch ? undefined : entries}
              onGenerate={() => void runGeneration('findings_report')}
            />

            {emptyMismatch && (
              <div
                data-testid="findings-report-basis-mismatch"
                className={`flex items-start gap-2 px-3 py-2 rounded-md border ${amberBox}`}
              >
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed flex-1">
                  The observation blocks shown here don’t match the server’s
                  record of the audit’s observations — approving is blocked
                  until they agree. Retry loading.
                </p>
                <button
                  type="button"
                  onClick={() => setReloadNonce((n) => n + 1)}
                  className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
                >
                  Retry
                </button>
              </div>
            )}

            {staleNotice && (
              <div
                data-testid="findings-report-stale-notice"
                className={`px-3 py-2 rounded-md border text-xs leading-relaxed ${amberBox}`}
              >
                {staleNotice}
              </div>
            )}
            {approveError && (
              <div
                role="alert"
                className={`px-3 py-2 rounded-md border text-xs leading-relaxed ${redBox}`}
              >
                {approveError}
              </div>
            )}
            {saveError && (
              <div
                role="alert"
                data-testid="findings-report-save-error"
                className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs leading-relaxed ${redBox}`}
              >
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <p className="flex-1">{saveError}</p>
                <button
                  type="button"
                  onClick={() => {
                    dismissSaveError('findings_report');
                    resetDrafts();
                  }}
                  aria-label="Discard the unsaved changes"
                  className="inline-flex items-center justify-center w-5 h-5 rounded opacity-70 hover:opacity-100"
                >
                  <XIcon size={11} />
                </button>
              </div>
            )}
            {diverged && (
              <div
                data-testid="findings-report-diverged"
                className={`flex items-start gap-2 px-3 py-2 rounded-md border ${amberBox}`}
              >
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  <span className="font-semibold">
                    The observations changed since this report was approved.
                  </span>{' '}
                  The blocks below already show the latest — re-review and
                  approve again to re-pin the report to them.
                </p>
              </div>
            )}

            {/* Document preview: narrative + injected blocks + narrative. */}
            <div className={`${cardBg} border rounded-md p-4 space-y-4`}>
              {editing ? (
                <div className="space-y-3">
                  <div>
                    <label className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                      Introduction
                    </label>
                    <textarea
                      value={draftIntro}
                      onChange={(e) => setDraftIntro(e.target.value)}
                      rows={5}
                      data-testid="findings-report-intro-input"
                      className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
                    />
                  </div>
                  <div>
                    <label className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                      Closing
                    </label>
                    <textarea
                      value={draftClosing}
                      onChange={(e) => setDraftClosing(e.target.value)}
                      rows={4}
                      data-testid="findings-report-closing-input"
                      className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
                    />
                  </div>
                  {approved && (
                    <div className={`flex items-start gap-2 px-3 py-2 rounded-md border ${amberBox}`}>
                      <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] leading-relaxed">
                        Saving will revert the report to Draft and clear its
                        pinned observation set.
                      </p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={save}
                      disabled={saving || (!draftIntro.trim() && !draftClosing.trim())}
                      data-testid="findings-report-save-button"
                      className={`text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      // Cancel = discard, exactly as the save-error banner's
                      // "Retry, or Cancel to discard it" copy promises — so it
                      // also clears the error + preserved-draft pair.
                      onClick={() => {
                        dismissSaveError('findings_report');
                        resetDrafts();
                      }}
                      className={`text-sm font-medium px-3.5 py-2 rounded-md transition-colors ${buttonSecondary}`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  {report?.content.intro_text ? (
                    <p className={`${headingColor} text-sm whitespace-pre-wrap leading-relaxed`}>
                      {report.content.intro_text}
                    </p>
                  ) : (
                    <p className={`${subColor} text-sm italic`}>
                      No introduction yet — draft with PIQC or write it here.
                    </p>
                  )}
                  <button
                    type="button"
                    data-testid="findings-report-edit-button"
                    onClick={() => {
                      setDraftIntro(report?.content.intro_text ?? '');
                      setDraftClosing(report?.content.closing_text ?? '');
                      setEditing(true);
                    }}
                    disabled={!hasReached || generating}
                    className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonSecondary}`}
                  >
                    <Pencil size={12} />
                    {approved ? 'Revise narrative' : 'Edit narrative'}
                  </button>
                </div>
              )}

              {/* Observation blocks — injected by code from live Stage-6
                  entries. NOT_YET_CLASSIFIED is excluded by the shared
                  builder; the count line below says so out loud. */}
              <div className="space-y-3">
                {observationGroups.map((group) => (
                  <div key={group.key}>
                    <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                      {DOCUMENT_GROUP_LABELS[group.key]} ({group.items.length})
                    </p>
                    {group.items.length === 0 ? (
                      <p className={`${subColor} text-xs italic mt-1`}>None recorded.</p>
                    ) : (
                      <div className="space-y-2 mt-1">
                        {group.items.map((b) => (
                          <div
                            key={b.entry.id}
                            data-testid={`findings-report-block-${b.entry.id}`}
                            className={`${cardBg} border rounded-md p-3`}
                          >
                            <p className={`${headingColor} text-sm leading-relaxed`}>
                              <span className="font-semibold">{b.number}.</span>{' '}
                              {b.observationText}
                            </p>
                            <p className={`${mutedColor} text-[11px] mt-1`}>
                              {b.vendorDomain} · Provisional impact: {b.impactLabel} ·
                              Provisional classification: {b.classificationLabel}
                              {b.checkpointRef ? (
                                <>
                                  {' '}· <span className="font-mono">{b.checkpointRef}</span>
                                </>
                              ) : null}
                            </p>
                            <p className={`${mutedColor} text-[11px] mt-0.5`}>{QA_PLACEHOLDER}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {unclassifiedCount > 0 && (
                  <p className={`${mutedColor} text-[11px]`}>
                    {unclassifiedCount} unclassified{' '}
                    {unclassifiedCount === 1 ? 'entry is' : 'entries are'} excluded
                    from this report — classify in Stage 6 to include them.
                  </p>
                )}
              </div>

              {!editing &&
                (report?.content.closing_text ? (
                  <p className={`${headingColor} text-sm whitespace-pre-wrap leading-relaxed`}>
                    {report.content.closing_text}
                  </p>
                ) : (
                  <p className={`${subColor} text-sm italic`}>No closing yet.</p>
                ))}
            </div>

            {/* Latch row */}
            <div className="flex items-center gap-2 flex-wrap">
              {approved ? (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border ${
                    isLight
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  }`}
                >
                  <CheckCircle2 size={11} />
                  Approved
                </span>
              ) : (
                <button
                  type="button"
                  onClick={approveNow}
                  // Blocked while: no saved row, save in flight or failed
                  // (PR-1 invariant), editing, digest unknown or inconsistent
                  // with the rendered blocks (the pin can't be stated
                  // honestly), preview from ahead.
                  disabled={
                    !report ||
                    saving ||
                    !!saveError ||
                    editing ||
                    liveDigest === null ||
                    emptyMismatch ||
                    !hasReached
                  }
                  title={
                    !report
                      ? 'Save a narrative first'
                      : liveDigest === null || emptyMismatch
                      ? 'Couldn’t verify the current observations — retry loading before approving'
                      : undefined
                  }
                  data-testid="findings-report-approve-button"
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonApprove}`}
                >
                  <CheckCircle2 size={12} />
                  Approve findings report
                </button>
              )}
              {approved && report?.approved_at && (
                <span className={`${subColor} text-xs`}>
                  Approved {new Date(report.approved_at).toLocaleDateString()}
                  {report.approved_by_name ? ` · ${report.approved_by_name}` : ''}
                </span>
              )}
              {/* !saving: during an in-flight FIRST save the cached row is an
                  optimistic mint whose id the history RPC would reject. */}
              {report && !saving && (
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
                  aria-label="Open change history for the findings report"
                >
                  <HistoryIcon size={12} />
                  History
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {historyOpen && report && (
        <HistoryDrawer
          objectType="FINDINGS_REPORT_OBJECT"
          objectId={report.id}
          title="Findings report"
          subTitle="Report drafting · change history"
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </section>
  );
}
