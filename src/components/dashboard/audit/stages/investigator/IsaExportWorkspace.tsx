import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  ClipboardCopy,
  Download,
  History as HistoryIcon,
  Lock,
  X as XIcon,
} from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import { useAudit } from '../../../../../context/AuditContext';
import { AUDIT_TYPE_LABELS } from '../../../../../lib/audit/labels';
import { formatAuditWindow } from '../../../../../lib/audit/dateWindow';
import { fetchIsaNotes } from '../../../../../lib/audit/isaNotesApi';
import { fetchIsaFindings } from '../../../../../lib/audit/isaFindingsApi';
import { resolveApprovedByName } from '../../../../../lib/audit/preAuditApi';
import {
  fetchIsaReportDraft,
  markIsaReportExported,
  signOffIsaReport,
  verifyIsaExportReadiness,
  type IsaExportArtifact,
  type IsaExportGate,
} from '../../../../../lib/audit/isaReportApi';
import {
  VERDICT_SENTENCES,
  buildIsaReportPacket,
  buildResponseClause,
  countBySeverity,
  type IsaReportMeta,
  type IsaReportPacket,
} from '../../../../../lib/audit/isaReportModel';
import { buildReportHtml, buildReportPlain } from '../../../../../lib/audit/isaReportClipboard';
import {
  buildIsaObservationFormDocx,
  buildIsaReportDocx,
} from '../../../../../lib/audit/isaReportDocx';
import { hasReachedStage } from '../../../../../lib/audit/workflowStages';
import type {
  AuditNoteObject,
  IsaFindingObject,
  IsaReportDraftObject,
} from '../../../../../types/audit';
import StagePreviewNotice from '../../StagePreviewNotice';
import HistoryDrawer from '../../HistoryDrawer';
import { copyRich, downloadBlob } from './isaReportDelivery';

// =============================================================================
// IsaExportWorkspace — ISA_EXPORT (Stage 7, "Review & export") center pane.
//
// The report's last honest checkpoint, laid out in the auditor's order of
// work: (1) readiness — is the verdict set, is the report signed off and
// still the version that was signed off; (2) what leaves PIQC — the
// summary of the assembled report; (3) sign-off — the latch; (4) export.
//
// The latch (20260919000100): sign-off asserts the row version the auditor
// saw and seals a server fingerprint over everything the export renders.
// Every export is verify → fresh read → mark → generate, so what leaves is
// what was signed off, built from freshly read state — never from this
// pane's. A change after sign-off (prose, verdict, a finding, a positive
// note) reads "changed since sign-off" and needs a new sign-off; it never
// silently exports. Stage 6 keeps its draft downloads; this stage's export
// is the recorded one (no "_draft" in the file name).
//
// State is local (IsaReportWorkspace precedent) and reloaded from the server
// after every mutation — one code path, always server truth. Not applied
// (the verify RPC missing) is its own honest state. House preview gate:
// viewed one ahead, StagePreviewNotice and every action disabled.
// =============================================================================

type LoadState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      draft: IsaReportDraftObject | null;
      findings: IsaFindingObject[];
      notes: AuditNoteObject[];
      /** The server's verdict from the last verify — empty = export ready. */
      reasons: IsaExportGate[];
      signedOffByName: string | null;
    };

const GATE_COPY: Record<IsaExportGate, string> = {
  GATE_ISA_VERDICT_NOT_SET:
    'Set the site continuation verdict on Report drafting before exporting.',
  GATE_ISA_REPORT_NOT_SIGNED_OFF: 'Sign off the report before exporting.',
  GATE_ISA_REPORT_DIVERGED:
    'The report changed since sign-off — review it and sign off again before exporting.',
};

function gateCopy(code: string | undefined): string {
  return code && code in GATE_COPY
    ? GATE_COPY[code as IsaExportGate]
    : 'The report is not ready to export — review the checklist above.';
}

function positiveNotes(notes: AuditNoteObject[]): AuditNoteObject[] {
  return notes.filter((n) => n.is_positive && !n.deleted_at);
}

async function loadAll(auditId: string): Promise<LoadState> {
  const [verifyRes, draftRes, findingsRes, notesRes] = await Promise.all([
    verifyIsaExportReadiness(auditId),
    fetchIsaReportDraft(auditId),
    fetchIsaFindings(auditId),
    fetchIsaNotes(auditId),
  ]);
  if (!verifyRes.ok) return { kind: 'error', message: verifyRes.error };
  if (!verifyRes.data.available) return { kind: 'unavailable' };
  if (!draftRes.ok) return { kind: 'error', message: draftRes.error };
  if (!findingsRes.ok) return { kind: 'error', message: findingsRes.error };
  if (!notesRes.ok) return { kind: 'error', message: notesRes.error };

  const draft = draftRes.data;
  const signedOffByName = draft?.final_signed_off_by
    ? await resolveApprovedByName(draft.final_signed_off_by)
    : null;
  return {
    kind: 'ready',
    draft,
    findings: findingsRes.data,
    notes: notesRes.data,
    reasons: verifyRes.data.reasons,
    signedOffByName,
  };
}

export default function IsaExportWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  const auditId = activeAudit?.id ?? '';
  // Mutations reload after an await; an audit switch in between must not
  // land the old audit's data under the new one.
  const auditIdRef = useRef(auditId);
  auditIdRef.current = auditId;

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reloadNonce, setReloadNonce] = useState(0);
  const [confirmingSignOff, setConfirmingSignOff] = useState(false);
  const [busy, setBusy] = useState<'sign_off' | IsaExportArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!auditId) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    setConfirmingSignOff(false);
    setError(null);
    setNotice(null);
    void loadAll(auditId).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [auditId, reloadNonce]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (!activeAudit) return null;

  const hasReached = hasReachedStage(
    activeAudit.workflow_type,
    activeAudit.current_stage,
    'ISA_EXPORT',
  );

  const refreshFor = async (id: string) => {
    const next = await loadAll(id);
    if (auditIdRef.current === id) setState(next);
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const ready = state.kind === 'ready' ? state : null;
  const draft = ready?.draft ?? null;
  const verdictSet = !!draft?.site_verdict;
  const signedOff = !!draft?.final_signed_off_at;
  const diverged = ready?.reasons.includes('GATE_ISA_REPORT_DIVERGED') ?? false;
  const sealCurrent = signedOff && !diverged;
  const exportReady = ready !== null && ready.reasons.length === 0;
  const actionsOn = hasReached && busy === null;

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
  const signOff = async () => {
    if (!ready || !draft || !verdictSet || !actionsOn) return;
    const id = auditId;
    setBusy('sign_off');
    setError(null);
    setNotice(null);
    const result = await signOffIsaReport(draft.id, draft.updated_at);
    if (auditIdRef.current === id) {
      setBusy(null);
      setConfirmingSignOff(false);
    }
    if (result.ok) {
      await refreshFor(id);
      return;
    }
    if (result.errorHint === 'STALE_CONTENT') {
      setNotice(
        'The report changed since you reviewed it — the latest version is shown. Review it and sign off again.',
      );
      await refreshFor(id);
      return;
    }
    setError(`Couldn’t sign off: ${result.error}`);
  };

  // What exports must be what was signed off: server-verify readiness, read
  // the state fresh, record the export, then build the blob from that fresh
  // read. Mark is itself gated server-side, so a race between verify and
  // mark still fails closed.
  const runVerifiedExport = async (
    artifact: IsaExportArtifact,
    generate: (packet: IsaReportPacket) => Promise<void>,
  ) => {
    if (!ready || !actionsOn) return;
    const id = auditId;
    setBusy(artifact);
    setError(null);
    setNotice(null);
    try {
      const verify = await verifyIsaExportReadiness(id);
      if (!verify.ok) {
        setError(`Couldn’t verify the report: ${verify.error}`);
        return;
      }
      if (!verify.data.available) {
        if (auditIdRef.current === id) setState({ kind: 'unavailable' });
        return;
      }
      if (!verify.data.ready) {
        setNotice(gateCopy(verify.data.reasons[0]));
        await refreshFor(id);
        return;
      }
      const fresh = await loadAll(id);
      if (fresh.kind !== 'ready' || !fresh.draft) {
        if (auditIdRef.current === id) setState(fresh);
        return;
      }
      const marked = await markIsaReportExported(fresh.draft.id, artifact);
      if (!marked.ok) {
        if (marked.errorHint && marked.errorHint in GATE_COPY) {
          setNotice(gateCopy(marked.errorHint));
        } else {
          setError(`Couldn’t record the export: ${marked.error}`);
        }
        await refreshFor(id);
        return;
      }
      const packet = buildIsaReportPacket(
        meta,
        marked.data,
        fresh.findings,
        positiveNotes(fresh.notes),
      );
      await generate(packet);
      if (auditIdRef.current === id) {
        setState({ ...fresh, draft: marked.data, reasons: [] });
      }
    } finally {
      if (auditIdRef.current === id) setBusy(null);
    }
  };

  const stamp = () => new Date().toISOString().slice(0, 10);
  const codeForName = () => meta.protocolCode ?? 'isa';

  const exportReportDocx = () =>
    runVerifiedExport('report_docx', async (packet) => {
      downloadBlob(
        await buildIsaReportDocx(packet),
        `${codeForName()}_site_audit_report_${stamp()}.docx`,
      );
    });

  const exportObservationFormDocx = () =>
    runVerifiedExport('observation_form_docx', async (packet) => {
      downloadBlob(
        await buildIsaObservationFormDocx(packet),
        `${codeForName()}_audit_observation_form_${stamp()}.docx`,
      );
    });

  const exportClipboard = () =>
    runVerifiedExport('clipboard', async (packet) => {
      if (await copyRich(buildReportHtml(packet), buildReportPlain(packet))) {
        setCopied(true);
      } else {
        setError('Copy failed — your browser blocked clipboard access.');
      }
    });

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 disabled:hover:bg-brand-600'
    : 'bg-brand-300/20 text-brand-300 hover:bg-brand-300/30 disabled:opacity-40 disabled:hover:bg-brand-300/20';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-fg-body hover:bg-[#F8FAFC] disabled:opacity-40 disabled:hover:bg-white'
    : 'bg-[#0F172A] border border-white/10 text-fg-body hover:bg-white/[0.04] disabled:opacity-40 disabled:hover:bg-[#0F172A]';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-[#CBD5E1] disabled:hover:bg-[#CBD5E1]'
    : 'bg-emerald-500 text-[#020617] hover:bg-emerald-400 disabled:bg-white/10 disabled:hover:bg-white/10 disabled:text-white/35';
  const amberBox = isLight
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : 'bg-amber-500/10 border-amber-500/25 text-amber-200';
  const redBox = isLight
    ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-red-500/15 border-red-500/30 text-red-300';
  const emeraldBox = isLight
    ? 'bg-emerald-50 border-emerald-200'
    : 'bg-emerald-500/10 border-emerald-500/30';
  const emeraldIcon = isLight ? 'text-emerald-600' : 'text-emerald-400';

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString();

  // ---------------------------------------------------------------------------
  // Readiness rows — client mirror of the server checker, from the same data
  // ---------------------------------------------------------------------------
  const gates = ready
    ? [
        {
          label: 'Site continuation verdict set',
          passed: verdictSet,
          detail: verdictSet
            ? 'Set on Report drafting — the sentence is in the summary below.'
            : 'Set it on Report drafting — the one sentence PIQC never drafts.',
        },
        {
          label: 'Signed off',
          passed: sealCurrent,
          detail: !signedOff
            ? 'Sign off below once the report reads as it should leave.'
            : diverged
            ? 'Changed since sign-off — review the report and sign off again.'
            : `Signed off ${formatDate(draft?.final_signed_off_at ?? '')}${
                ready.signedOffByName ? ` · ${ready.signedOffByName}` : ''
              }`,
        },
      ]
    : [];

  const counts = ready ? countBySeverity(ready.findings) : null;
  const positives = ready ? positiveNotes(ready.notes) : [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {!hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}

      {/* Header */}
      <div>
        <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          Stage 7 · Review &amp; export
        </p>
        <h2 className="text-fg-heading text-xl font-semibold mt-1">
          {sealCurrent ? 'Report signed off' : 'Sign off and export'}
        </h2>
        <p className="text-fg-sub text-sm mt-1.5 leading-relaxed max-w-2xl">
          Confirm the report reads as it should leave, sign it off, and export. What exports
          is what you signed off — any later change must be signed off again.
        </p>
      </div>

      {state.kind === 'loading' && (
        <p className="text-fg-sub text-sm">Loading the report…</p>
      )}

      {state.kind === 'unavailable' && (
        <p className="text-fg-sub text-sm">
          Review &amp; export isn’t available in this environment yet.
        </p>
      )}

      {state.kind === 'error' && (
        <div role="alert" className={`text-xs px-3 py-2 rounded-md border ${redBox}`}>
          Couldn’t load the report: {state.message}
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="ml-2 underline font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {ready && (
        <>
          {notice && (
            <div
              role="status"
              className={`flex items-start gap-2 text-xs px-3 py-2 rounded-md border ${amberBox}`}
            >
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <p className="flex-1">{notice}</p>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label="Dismiss the notice"
                className="inline-flex items-center justify-center w-5 h-5 rounded opacity-70 hover:opacity-100"
              >
                <XIcon size={11} />
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className={`flex items-start gap-2 text-xs px-3 py-2 rounded-md border ${redBox}`}
            >
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <p className="flex-1">{error}</p>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label="Dismiss the error"
                className="inline-flex items-center justify-center w-5 h-5 rounded opacity-70 hover:opacity-100"
              >
                <XIcon size={11} />
              </button>
            </div>
          )}

          {/* Signed-off banner — replaces the sign-off card while the seal is current */}
          {sealCurrent && draft && (
            <div className={`flex items-start gap-3 p-4 rounded-xl border ${emeraldBox}`}>
              <div
                className={`inline-flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 ${
                  isLight ? 'bg-emerald-100' : 'bg-emerald-500/20'
                }`}
              >
                <Lock size={16} className={emeraldIcon} />
              </div>
              <div className="min-w-0">
                <p className="text-fg-heading text-sm font-semibold">Report signed off</p>
                <p className="text-fg-sub text-xs mt-0.5">
                  {formatDate(draft.final_signed_off_at ?? '')}
                  {ready.signedOffByName ? ` by ${ready.signedOffByName}` : ''}. Exports record
                  against this version; any later change needs a new sign-off.
                </p>
              </div>
            </div>
          )}

          {/* 1. Readiness */}
          <section className={`${cardBg} border rounded-xl p-5`}>
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                Before export
              </p>
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                disabled={!draft}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
                aria-label="Open change history for the site audit report"
              >
                <HistoryIcon size={12} />
                History
              </button>
            </div>
            <ul className="space-y-2.5">
              {gates.map((g) => (
                <li key={g.label} className="flex items-start gap-3">
                  {g.passed ? (
                    <CheckCircle2 size={16} className={`flex-shrink-0 mt-0.5 ${emeraldIcon}`} />
                  ) : (
                    <Circle size={16} className="flex-shrink-0 mt-0.5 text-fg-muted" />
                  )}
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${g.passed ? 'text-fg-heading' : 'text-fg-sub'}`}>
                      {g.label}
                    </p>
                    <p className="text-fg-sub text-xs mt-0.5">{g.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* 2. What leaves PIQC */}
          <section className={`${cardBg} border rounded-xl p-5`}>
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              What leaves PIQC
            </p>
            <h3 className="text-fg-heading text-sm font-semibold mt-1">
              Site audit report — {meta.auditeeName}
            </h3>
            <dl className="mt-3 grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-fg-muted">Protocol</dt>
              <dd className="text-fg-body">
                {meta.protocolCode ?? '—'}
                {meta.protocolTitle ? ` · ${meta.protocolTitle}` : ''}
              </dd>
              <dt className="text-fg-muted">Audit</dt>
              <dd className="text-fg-body">
                {meta.auditTypeLabel} · {meta.auditDate}
              </dd>
              <dt className="text-fg-muted">Verdict</dt>
              <dd className="text-fg-body">
                {draft?.site_verdict
                  ? `${VERDICT_SENTENCES[draft.site_verdict]}${
                      draft.site_verdict_text ? ` ${draft.site_verdict_text}` : ''
                    }`
                  : 'Not set'}
              </dd>
              <dt className="text-fg-muted">Findings</dt>
              <dd className="text-fg-body">
                {counts
                  ? `${ready.findings.length} · ${counts.CRITICAL} critical · ${counts.MAJOR} major · ${counts.MINOR} minor · ${counts.RECOMMENDATION} ${
                      counts.RECOMMENDATION === 1 ? 'recommendation' : 'recommendations'
                    }`
                  : '—'}
              </dd>
              <dt className="text-fg-muted">Positive observations</dt>
              <dd className="text-fg-body">{positives.length}</dd>
              <dt className="text-fg-muted">Response</dt>
              <dd className="text-fg-body">
                {buildResponseClause(
                  draft?.response_due_days ?? 30,
                  draft?.response_due_basis ?? 'CALENDAR',
                )}
              </dd>
            </dl>
            <p className="text-fg-muted text-xs mt-3">
              The full assembled report is on Report drafting; nothing is re-drafted here.
            </p>
          </section>

          {/* 3. Sign-off — hidden while the seal is current */}
          {!sealCurrent && (
            <section className={`${cardBg} border rounded-xl p-5`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 max-w-xl">
                  <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                    Sign-off
                  </p>
                  <p className="text-fg-heading text-sm font-semibold mt-1">
                    {signedOff ? 'Sign off the changed report' : 'Sign off the report'}
                  </p>
                  <p className="text-fg-sub text-xs mt-1 leading-relaxed">
                    {signedOff
                      ? 'The report changed since it was signed off. Review it on Report drafting, then seal the new version — the earlier export no longer describes it.'
                      : 'Signing off seals this version as reviewed. Exports record against it; any later change to the prose, verdict, findings or positive observations must be signed off again.'}
                  </p>
                  {!verdictSet && (
                    <p className="text-fg-muted text-xs mt-2">
                      Set the site continuation verdict on Report drafting first.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {confirmingSignOff ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void signOff()}
                        disabled={!actionsOn || !verdictSet || !draft}
                        className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonApprove}`}
                      >
                        {busy === 'sign_off' ? 'Signing off…' : 'Confirm sign-off'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingSignOff(false)}
                        disabled={busy !== null}
                        className={`inline-flex items-center text-sm font-medium px-3 py-2 rounded-md transition-colors ${buttonSecondary}`}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingSignOff(true)}
                      disabled={!actionsOn || !verdictSet || !draft}
                      title={
                        !hasReached
                          ? 'Available when the audit reaches this stage'
                          : !verdictSet
                          ? 'Set the site continuation verdict first'
                          : undefined
                      }
                      className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonApprove}`}
                    >
                      <Lock size={14} />
                      {signedOff ? 'Sign off again' : 'Sign off report'}
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* 4. Export */}
          <section className={`${cardBg} border rounded-xl p-5`}>
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              Export
            </p>
            <p className="text-fg-sub text-xs mt-1 leading-relaxed max-w-xl">
              Each export is verified against the signed-off version and recorded. Sponsor
              branding is added externally.
            </p>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void exportReportDocx()}
                disabled={!actionsOn || !exportReady}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
              >
                <Download size={13} />
                {busy === 'report_docx' ? 'Exporting…' : 'Download report .docx'}
              </button>
              <button
                type="button"
                onClick={() => void exportObservationFormDocx()}
                disabled={!actionsOn || !exportReady}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
              >
                <Download size={13} />
                {busy === 'observation_form_docx' ? 'Exporting…' : 'Download observation form .docx'}
              </button>
              <button
                type="button"
                onClick={() => void exportClipboard()}
                disabled={!actionsOn || !exportReady}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
              >
                {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
                {busy === 'clipboard' ? 'Copying…' : copied ? 'Copied' : 'Copy for Word / Docs'}
              </button>
            </div>
            {!exportReady && (
              <p className="text-fg-muted text-xs mt-3">{gateCopy(ready.reasons[0])}</p>
            )}
            {exportReady && draft?.exported_at && (
              <p className="text-fg-muted text-xs mt-3">
                Last exported {formatDate(draft.exported_at)}.
              </p>
            )}
          </section>
        </>
      )}

      {historyOpen && draft && (
        <HistoryDrawer
          objectType="ISA_REPORT_DRAFT_OBJECT"
          objectId={draft.id}
          title="Site audit report"
          subTitle="Review & export · change history"
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}
