import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  History as HistoryIcon,
  Pencil,
  X as XIcon,
} from 'lucide-react';
import {
  approveAuditCertificate,
  fetchAuditCertificate,
  fetchReportBasis,
  upsertAuditCertificate,
  type AuditCertificate,
  type ReportBasis,
} from '../../../../lib/audit/auditCertificate';
import { listAuditEvidence } from '../../../../lib/audit/evidenceApi';
import { formatAuditWindow } from '../../../../lib/audit/dateWindow';
import type { AuditWithContext } from '../../../../context/AuditContext';
import type { AuditEvidenceListRow } from '../../../../types/audit';
import DeliverableGenerationPanel from '../deliverables/DeliverableGenerationPanel';
import { useDeliverablePersistence } from '../deliverables/useDeliverablePersistence';
import { useDeliverableGeneration } from '../deliverables/useDeliverableGeneration';
import { useDeliverableResync } from '../deliverables/useDeliverableResync';
import HistoryDrawer from '../HistoryDrawer';

// =============================================================================
// AuditCertificateSection — the audit certificate deliverable (PR-D6),
// rendered as a section of Stage-8 FinalReviewExportWorkspace. Mount with
// key={audit.id}: all state here is audit-scoped and resets by remount.
//
// The document = model-draftable descriptive narrative ({body_text, scope},
// stored) inside a code-owned frame: the audit facts header (vendor, audit
// name, type, window, protocol) renders from the audit record, and the
// outcome + certificate-date template lines are code-owned — the certificate
// records THAT the audit happened and never states a result. The sponsor's
// QA fills the outcome and date outside PIQC.
//
// Latch honesty: Approve requires the approved Stage-7 report's
// readiness_fingerprint (the version a human approved) and passes it as the
// basis pin. The basis comes from ONE report-row read (fetchReportBasis), so
// the displayed report state and the pinned digest cannot disagree. Basis
// unknown (read failed) or null (report unapproved) → Approve stays blocked,
// because an approval that can't name which report it certifies is the
// dishonest latch this kind exists to prevent. After approval, live
// fingerprint ≠ sealed digest renders the divergence banner.
//
// Generation is sequence-gated on the same predicate — the engine enforces it
// server-side (409 REPORT_NOT_APPROVED); the panel's lockedReason is the
// honest surface of that rule, not the gate.
// =============================================================================

// Code-owned template lines. Never model-generated; never stored. See the
// plan's binding decision 2 — in-PIQC approval is a readiness latch, and the
// outcome + date are the sponsor QA's to fill outside PIQC.
const OUTCOME_PLACEHOLDER = '[Outcome: to be determined by QA]';
const DATE_PLACEHOLDER = 'Certificate date: ____________';

interface AuditCertificateBundle {
  audit_certificate: AuditCertificate | null;
}

interface Props {
  audit: AuditWithContext;
  hasReached: boolean;
  isLight: boolean;
}

export default function AuditCertificateSection({ audit, hasReached, isLight }: Props) {
  const auditId = audit.id;
  const [certificate, setCertificate] = useState<AuditCertificate | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Absence ≠ failure: failed means the row state is UNKNOWN — render the
  // retry banner, never a scratch form (a transient read failure must not
  // masquerade as "never drafted").
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  // null = no register data (loading or failed) → the panel renders no
  // currency verdict rather than diffing against [].
  const [evidenceRows, setEvidenceRows] = useState<AuditEvidenceListRow[] | null>(null);
  // null = report basis unknown (read failed) → Approve blocked, honestly
  // labeled. digest null inside = report not approved → Approve blocked too.
  const [reportBasis, setReportBasis] = useState<ReportBasis | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [draftScope, setDraftScope] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const {
    savingTabs,
    persistErrors,
    approveErrors,
    staleReloadNotices,
    persistDeliverable,
    dismissSaveError,
  } = useDeliverablePersistence<AuditCertificateBundle>({
    auditId,
    setField: (_key, value) => setCertificate(value),
    refresh: refreshFromServer,
    logTag: 'AuditCertificateSection',
  });

  const { generatingTab, generationError, runGeneration } = useDeliverableGeneration({
    auditId,
    hasReached,
    refresh: refreshFromServer,
  });

  // THE refetch path (hook contract: never throws; false = row refresh
  // failed). Row + report basis + register together: whenever server truth is
  // re-read, the pin and the report state it names are re-read in the same
  // moment — so "the latest is shown" claims after a stale-approve reload are
  // actually true.
  async function refreshFromServer(): Promise<boolean> {
    const [rowFetch, basis, evidence] = await Promise.all([
      fetchAuditCertificate(auditId),
      fetchReportBasis(auditId),
      listAuditEvidence(auditId),
    ]);
    setReportBasis(basis);
    if (evidence.ok) setEvidenceRows(evidence.data);
    if (rowFetch.failed) return false;
    setCertificate(rowFetch.certificate);
    return true;
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [rowFetch, basis, evidence] = await Promise.all([
        fetchAuditCertificate(auditId),
        fetchReportBasis(auditId),
        listAuditEvidence(auditId),
      ]);
      if (cancelled) return;
      setLoaded(true);
      setLoadFailed(rowFetch.failed);
      if (!rowFetch.failed) setCertificate(rowFetch.certificate);
      setReportBasis(basis);
      setEvidenceRows(evidence.ok ? evidence.data : null);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [auditId, reloadNonce]);

  const saveError = persistErrors[auditId]?.['audit_certificate'] ?? null;
  const approveError = approveErrors['audit_certificate'] ?? null;
  const staleNotice = staleReloadNotices['audit_certificate'] ?? null;
  const saving = savingTabs['audit_certificate'] === true;
  const generating = generatingTab === 'audit_certificate';

  // Exit edit mode and re-seed the editors from the cached row — the one
  // draft-reset, shared by resync, Cancel, and save-error discard.
  const resetDrafts = () => {
    setEditing(false);
    setDraftBody(certificate?.content.body_text ?? '');
    setDraftScope(certificate?.content.scope.join('\n') ?? '');
  };

  useDeliverableResync({
    deliverable: certificate,
    saveError,
    syncFromServer: resetDrafts,
    forceEdit: () => setEditing(true),
  });

  const upsertOp = (n: AuditCertificate) => upsertAuditCertificate(auditId, n.content);

  const save = () => {
    const prev = certificate;
    const next: AuditCertificate = {
      id: prev?.id ?? `audit-certificate-${Date.now()}`,
      audit_id: auditId,
      content: {
        body_text: draftBody.trim(),
        scope: draftScope
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      },
      approval_status: 'DRAFT',
      approved_at: null,
      approved_by_name: null,
      updated_at: prev?.updated_at ?? new Date(0).toISOString(),
      basis_digest: null,
      generation_refs: prev?.generation_refs ?? null,
      grounding_snapshot: prev?.grounding_snapshot ?? null,
      generated_at: prev?.generated_at ?? null,
    };
    setCertificate(next);
    setEditing(false);
    void persistDeliverable('audit_certificate', 'AuditCertificate', prev, next, {
      upsert: upsertOp,
      // Unreachable from a save (next stays DRAFT — no approval transition);
      // present to satisfy the ops contract without a phantom digest.
      approve: (p) => approveAuditCertificate(p.id, p.updated_at, reportBasis?.digest ?? ''),
    });
  };

  const approveNow = () => {
    const digest = reportBasis?.digest ?? null;
    if (!certificate || digest === null || saving || saveError) return;
    const next: AuditCertificate = { ...certificate, approval_status: 'APPROVED' };
    setCertificate(next);
    void persistDeliverable('audit_certificate', 'AuditCertificate', certificate, next, {
      upsert: upsertOp,
      approve: (p) => approveAuditCertificate(p.id, p.updated_at, digest),
    });
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const approved = certificate?.approval_status === 'APPROVED';
  const reportApproved = reportBasis?.approved === true;
  // Post-approval divergence: the sealed basis no longer matches the live
  // report — its text changed and was re-approved (new fingerprint), or its
  // approval was voided (digest null). Both sides must be known — an unknown
  // report basis is reported as unknown (approve blocked), never as diverged.
  const diverged =
    approved &&
    !!certificate?.basis_digest &&
    reportBasis !== null &&
    certificate.basis_digest !== reportBasis.digest;
  const auditWindow = formatAuditWindow(audit.scheduled_date, audit.scheduled_end_date);

  // ---------------------------------------------------------------------------
  // Theme tokens (Stage-8 palette)
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
    <section data-testid="audit-certificate-section" className={`${cardBg} border rounded-xl p-5`}>
      <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
        Audit certificate
      </p>
      <div className="space-y-2 mt-2">
        <p className={`${subColor} text-xs leading-relaxed max-w-2xl`}>
          The terminal record that the audit happened — what was audited, when,
          and what it covered. It never states a result: the outcome and
          certificate date stay with the sponsor&rsquo;s QA. Approving pins the
          certificate to the approved report&rsquo;s exact version. Optional; it
          never gates anything.
        </p>

        {!loaded ? (
          <p className={`${subColor} text-sm italic`}>Loading audit certificate…</p>
        ) : loadFailed ? (
          // Honest load failure — absence ≠ failure, so no scratch form here.
          <div
            role="alert"
            data-testid="audit-certificate-load-error"
            className={`flex items-start gap-2 px-3 py-2 rounded-md border ${redBox}`}
          >
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <p className="text-sm leading-relaxed flex-1">
              The audit certificate could not be loaded — it may exist. Retry
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
              kind="audit_certificate"
              noun="audit certificate"
              deliverable={certificate}
              evidenceRows={evidenceRows}
              generating={generating}
              editing={editing}
              error={generationError}
              isLight={isLight}
              previewLocked={!hasReached}
              lockedReason={
                reportApproved
                  ? undefined
                  : 'Available once the audit report is approved'
              }
              privacyNote="Dates, vendor identity, and the outcome line never round-trip through the model — PIQC drafts only the descriptive narrative."
              onGenerate={() => void runGeneration('audit_certificate')}
            />

            {reportBasis === null && (
              <div
                data-testid="audit-certificate-basis-unknown"
                className={`flex items-start gap-2 px-3 py-2 rounded-md border ${amberBox}`}
              >
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed flex-1">
                  The audit report&rsquo;s approval state couldn&rsquo;t be read
                  — approving the certificate is blocked until it can name which
                  report version it certifies. Retry loading.
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
            {reportBasis !== null && reportApproved && reportBasis.digest === null && (
              // Legacy edge: a report approved before the version fingerprint
              // existed. Approve stays blocked with the fix named out loud.
              <div
                data-testid="audit-certificate-legacy-report"
                className={`px-3 py-2 rounded-md border text-xs leading-relaxed ${amberBox}`}
              >
                The report&rsquo;s approved version can&rsquo;t be identified
                (it was approved before version pinning existed) — re-approve
                the report in Stage 7 to enable certificate approval.
              </div>
            )}

            {staleNotice && (
              <div
                data-testid="audit-certificate-stale-notice"
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
                data-testid="audit-certificate-save-error"
                className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs leading-relaxed ${redBox}`}
              >
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <p className="flex-1">{saveError}</p>
                <button
                  type="button"
                  onClick={() => {
                    dismissSaveError('audit_certificate');
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
                data-testid="audit-certificate-diverged"
                className={`flex items-start gap-2 px-3 py-2 rounded-md border ${amberBox}`}
              >
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  <span className="font-semibold">
                    The audit report changed — or is no longer approved — since
                    this certificate was approved.
                  </span>{' '}
                  Re-review once the report is approved again, then approve the
                  certificate to re-pin it.
                </p>
              </div>
            )}

            {/* Document preview: code-owned facts header + narrative + scope +
                code-owned outcome/date template lines. */}
            <div className={`${cardBg} border rounded-md p-4 space-y-4`}>
              <div>
                <p className={`${headingColor} text-sm font-semibold`}>
                  {audit.audit_name}
                </p>
                <p className={`${mutedColor} text-[11px] mt-1`} data-testid="audit-certificate-facts">
                  Vendor: {audit.vendor_name || '—'} · Audit type: {audit.audit_type}
                  {auditWindow ? ` · Audit dates: ${auditWindow}` : ''}
                  {audit.protocol_code ? ` · Protocol: ${audit.protocol_code}` : ''}
                </p>
              </div>

              {editing ? (
                <div className="space-y-3">
                  <div>
                    <label className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                      Certificate narrative
                    </label>
                    <textarea
                      value={draftBody}
                      onChange={(e) => setDraftBody(e.target.value)}
                      rows={6}
                      data-testid="audit-certificate-body-input"
                      className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
                    />
                  </div>
                  <div>
                    <label className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                      Scope covered (one area per line)
                    </label>
                    <textarea
                      value={draftScope}
                      onChange={(e) => setDraftScope(e.target.value)}
                      rows={4}
                      data-testid="audit-certificate-scope-input"
                      className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
                    />
                  </div>
                  {approved && (
                    <div className={`flex items-start gap-2 px-3 py-2 rounded-md border ${amberBox}`}>
                      <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] leading-relaxed">
                        Saving will revert the certificate to Draft and clear
                        its pinned report version.
                      </p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={save}
                      disabled={saving || (!draftBody.trim() && !draftScope.trim())}
                      data-testid="audit-certificate-save-button"
                      className={`text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      // Cancel = discard, exactly as the save-error banner's
                      // dismiss does — so it also clears the error +
                      // preserved-draft pair.
                      onClick={() => {
                        dismissSaveError('audit_certificate');
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
                  {certificate?.content.body_text ? (
                    <p className={`${headingColor} text-sm whitespace-pre-wrap leading-relaxed`}>
                      {certificate.content.body_text}
                    </p>
                  ) : (
                    <p className={`${subColor} text-sm italic`}>
                      No certificate narrative yet — draft with PIQC or write it
                      here.
                    </p>
                  )}
                  {certificate && certificate.content.scope.length > 0 && (
                    <div className="mt-3">
                      <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                        Scope Covered
                      </p>
                      <ul className={`${headingColor} text-sm mt-1 space-y-0.5 list-disc list-inside`}>
                        {certificate.content.scope.map((area, i) => (
                          <li key={i}>{area}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <button
                    type="button"
                    data-testid="audit-certificate-edit-button"
                    onClick={() => {
                      setDraftBody(certificate?.content.body_text ?? '');
                      setDraftScope(certificate?.content.scope.join('\n') ?? '');
                      setEditing(true);
                    }}
                    disabled={!hasReached || generating}
                    className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonSecondary}`}
                  >
                    <Pencil size={12} />
                    {approved ? 'Revise certificate' : 'Edit certificate'}
                  </button>
                </div>
              )}

              {/* Code-owned template lines — never model-written, never stored.
                  The sponsor's QA fills them outside PIQC. */}
              <div
                className={`border-t pt-3 ${isLight ? 'border-[#E2E8F0]' : 'border-white/10'}`}
                data-testid="audit-certificate-template-lines"
              >
                <p className={`${mutedColor} text-[11px]`}>{OUTCOME_PLACEHOLDER}</p>
                <p className={`${mutedColor} text-[11px] mt-0.5`}>{DATE_PLACEHOLDER}</p>
              </div>
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
                  // (PR-1 invariant), editing, the report basis is unknown or
                  // the report unapproved (the pin can't be stated honestly),
                  // preview from ahead.
                  disabled={
                    !certificate ||
                    saving ||
                    !!saveError ||
                    editing ||
                    reportBasis === null ||
                    reportBasis.digest === null ||
                    !hasReached
                  }
                  title={
                    !certificate
                      ? 'Save a certificate first'
                      : reportBasis === null
                      ? 'Couldn’t verify the report’s approval — retry loading before approving'
                      : reportBasis.digest === null
                      ? 'The audit report must be approved before the certificate can be'
                      : undefined
                  }
                  data-testid="audit-certificate-approve-button"
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonApprove}`}
                >
                  <CheckCircle2 size={12} />
                  Approve audit certificate
                </button>
              )}
              {approved && certificate?.approved_at && (
                <span className={`${subColor} text-xs`}>
                  Approved {new Date(certificate.approved_at).toLocaleDateString()}
                  {certificate.approved_by_name ? ` · ${certificate.approved_by_name}` : ''}
                </span>
              )}
              {/* !saving: during an in-flight FIRST save the cached row is an
                  optimistic mint whose id the history RPC would reject. */}
              {certificate && !saving && (
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
                  aria-label="Open change history for the audit certificate"
                >
                  <HistoryIcon size={12} />
                  History
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {historyOpen && certificate && (
        <HistoryDrawer
          objectType="AUDIT_CERTIFICATE_OBJECT"
          objectId={certificate.id}
          title="Audit certificate"
          subTitle="Final review · change history"
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </section>
  );
}
