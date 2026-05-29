import { useEffect, useRef, useState } from 'react';
import { X, Building2, FileText, Upload, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useOverlay } from '../../../../hooks/useOverlay';
import {
  listVendors,
  createVendor,
  listAuditorProtocolLibrary,
  uploadProtocolPdf,
  createProtocolFromDocument,
  createAudit,
  type VendorRow,
  type AuditorProtocolRow,
} from '../../../../lib/audit/auditCreationApi';
import { AUDIT_TYPE_LABELS } from '../../../../lib/audit/labels';
import type { AuditType, ClinicalTrialPhase } from '../../../../types/audit';

// =============================================================================
// NewAuditDrawer — Audit Mode onramp (F-1).
//
// Standalone product surface — never reads from or references Site Mode UI.
// The auditor:
//   1. Names the audit
//   2. Picks (or adds) a vendor
//   3. Picks an existing protocol from their library, OR uploads a new PDF
//   4. Sets audit type + scheduled date
//   5. Submits — lands inside the new audit at Stage 1 INTAKE
//
// Backend: three RPCs in 20260515030000_audit_mode_onramp_rpcs.sql,
// plus the shared /functions/v1/ingest edge function for PDF parsing.
// =============================================================================

interface Props {
  onClose: () => void;
  /** Called after the audit is created and AuditContext has been refreshed,
   *  with the new audit's id so the host can route the auditor into it. */
  onCreated: (newAuditId: string) => void;
}

type ProtocolMode = 'existing' | 'upload';

const AUDIT_TYPES: AuditType[] = ['REMOTE', 'ONSITE', 'HYBRID'];

const PHASE_OPTIONS: { value: ClinicalTrialPhase; label: string }[] = [
  { value: 'NOT_APPLICABLE', label: 'Not applicable' },
  { value: 'PHASE_1', label: 'Phase 1' },
  { value: 'PHASE_2', label: 'Phase 2' },
  { value: 'PHASE_3', label: 'Phase 3' },
  { value: 'PHASE_4', label: 'Phase 4' },
];

export default function NewAuditDrawer({ onClose, onCreated }: Props) {
  const { theme } = useTheme();
  const { refresh: refreshAudits } = useAudit();
  const isLight = theme === 'light';
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });

  // ---------------------------------------------------------------------------
  // Form state
  // ---------------------------------------------------------------------------
  const [auditName, setAuditName] = useState('');
  const [auditType, setAuditType] = useState<AuditType>('REMOTE');
  const [scheduledDate, setScheduledDate] = useState<string>('');

  // Vendors
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [vendorId, setVendorId] = useState<string>('');
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendor, setNewVendor] = useState({ name: '', country: '', website: '' });

  // Protocols
  const [protocols, setProtocols] = useState<AuditorProtocolRow[]>([]);
  const [protocolMode, setProtocolMode] = useState<ProtocolMode>('existing');
  const [protocolVersionId, setProtocolVersionId] = useState<string>('');

  // Upload-new fields
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfTitle, setPdfTitle] = useState('');
  const [pdfSponsor, setPdfSponsor] = useState('');
  const [pdfStudyNumber, setPdfStudyNumber] = useState('');
  const [pdfPhase, setPdfPhase] = useState<ClinicalTrialPhase>('NOT_APPLICABLE');

  // Document id from a previously-successful upload. Tracked so a failure on
  // a later submission step (protocol creation, audit creation) doesn't cause
  // a duplicate upload on retry. Cleared when the auditor picks a new file.
  // See follow-up to PR #59 / #60.
  const [uploadedDocumentId, setUploadedDocumentId] = useState<string | null>(null);

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [progressStep, setProgressStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Bootstrap reads
  // ---------------------------------------------------------------------------
  useEffect(() => {
    void (async () => {
      const [v, p] = await Promise.all([listVendors(), listAuditorProtocolLibrary()]);
      setVendors(v);
      setProtocols(p);
      // If the auditor has no library yet, default to upload mode.
      if (p.length === 0) setProtocolMode('upload');
    })();
  }, []);

  // ---------------------------------------------------------------------------
  // Theme tokens (calm, consistent with AuditWorkspaceShell)
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const labelColor = 'text-fg-heading';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const inputBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const inputBorder = isLight
    ? 'border-[#CBD5E1] focus:border-[#02BBB8] focus:ring-1 focus:ring-[#02BBB8]/30'
    : 'border-white/15 focus:border-[#6FC9C7] focus:ring-1 focus:ring-[#6FC9C7]/30';
  const buttonPrimary = isLight
    ? 'bg-[#02BBB8] text-white hover:bg-[#016663] disabled:bg-[#CBD5E1]'
    : 'bg-[#6FC9C7] text-[#0F172A] hover:bg-[#028E8B] disabled:bg-white/10 disabled:text-white/35';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';
  const tabActive = isLight ? 'border-[#02BBB8] text-[#02BBB8]' : 'border-[#6FC9C7] text-[#6FC9C7]';
  const tabInactive = isLight
    ? 'border-transparent text-[#334155]/60 hover:text-[#0F172A]'
    : 'border-transparent text-[#CBD5E1]/55 hover:text-white';

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const canSubmit = (() => {
    if (!auditName.trim()) return false;
    if (!vendorId) return false;
    if (protocolMode === 'existing' && !protocolVersionId) return false;
    if (protocolMode === 'upload') {
      if (!pdfFile) return false;
      if (!pdfTitle.trim()) return false;
      if (!pdfSponsor.trim()) return false;
    }
    return true;
  })();

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      // Resolve protocol_version_id — either picked from library, or upload + promote.
      let versionId = protocolVersionId;

      if (protocolMode === 'upload') {
        if (!pdfFile) throw new Error('Pick a PDF to upload.');

        // Skip re-upload on retry — if a previous submit got past step 1 but
        // failed later, the documents row already exists. Re-uploading would
        // create an orphan. The cached id is invalidated when the auditor
        // picks a new file (see the file input onChange above).
        let documentId = uploadedDocumentId;
        if (!documentId) {
          setProgressStep('Uploading and parsing protocol PDF…');
          const upload = await uploadProtocolPdf(pdfFile, pdfTitle || pdfFile.name);
          documentId = upload.document_id;
          setUploadedDocumentId(documentId);
        }

        setProgressStep('Indexing protocol…');
        const version = await createProtocolFromDocument({
          documentId,
          title: pdfTitle.trim(),
          sponsor: pdfSponsor.trim(),
          studyNumber: pdfStudyNumber.trim() || undefined,
          phase: pdfPhase,
        });
        if (!version) throw new Error('Could not register the parsed protocol.');
        versionId = version.id;
      }

      setProgressStep('Creating audit…');
      const audit = await createAudit({
        auditName: auditName.trim(),
        vendorId,
        protocolVersionId: versionId,
        auditType,
        scheduledDate: scheduledDate || null,
      });
      if (!audit) throw new Error('Audit creation failed.');

      // Refresh the AuditContext worklist so the new audit appears and can be
      // activated by the host via onCreated(audit.id).
      setProgressStep('Opening audit…');
      await refreshAudits();
      onCreated(audit.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error.';
      console.error('[NewAuditDrawer] submit error:', err);
      setError(message);
    } finally {
      setSubmitting(false);
      setProgressStep('');
    }
  };

  const handleAddVendor = async () => {
    if (!newVendor.name.trim() || !newVendor.country.trim()) return;
    const created = await createVendor({
      name: newVendor.name,
      country: newVendor.country,
      website: newVendor.website || undefined,
    });
    if (created) {
      setVendors((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setVendorId(created.id);
      setAddingVendor(false);
      setNewVendor({ name: '', country: '', website: '' });
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      data-testid="new-audit-drawer"
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Start a new audit"
    >
      <div
        data-testid="new-audit-drawer-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={submitting ? undefined : onClose}
      />

      <div
        ref={panelRef}
        className={`relative w-full max-w-xl h-full overflow-y-auto shadow-xl border-l ${
          isLight
            ? 'bg-[#F8FAFC] border-[#E2E8F0]'
            : 'bg-[#020617] border-white/5'
        }`}
      >
        {/* Header — "PIQC Clinical · Audit" framing keeps this surface
            self-contained as a standalone product, not a borrowed feature. */}
        <div
          className={`sticky top-0 z-10 px-5 py-3.5 border-b backdrop-blur ${
            isLight
              ? 'bg-[#F8FAFC]/95 border-[#E2E8F0]'
              : 'bg-[#020617]/95 border-white/5'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                PIQC Clinical · Audit
              </p>
              <h2 className={`${headingColor} text-sm font-semibold mt-0.5`}>
                Start a new audit
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close"
              className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${mutedColor} hover:bg-[#E2E8F0] dark:hover:bg-white/[0.06] disabled:opacity-40`}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="px-5 py-5 space-y-6">
          {/* ----- Audit name ----- */}
          <Field label="Audit name" required labelColor={labelColor}>
            <input
              type="text"
              value={auditName}
              onChange={(e) => setAuditName(e.target.value)}
              placeholder="e.g. Q2 2026 ePRO platform audit"
              className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
              disabled={submitting}
            />
          </Field>

          {/* ----- Vendor ----- */}
          <Field label="Vendor" required labelColor={labelColor} icon={Building2}>
            {!addingVendor ? (
              <div className="flex gap-2">
                <select
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                  disabled={submitting}
                >
                  <option value="">Pick the vendor you're auditing…</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.country ? `· ${v.country}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setAddingVendor(true)}
                  className={`text-xs font-medium px-3 py-2 rounded-md transition-colors ${buttonSecondary}`}
                  disabled={submitting}
                >
                  + Add
                </button>
              </div>
            ) : (
              <div
                className={`space-y-2 p-3 rounded-md border ${
                  isLight ? 'bg-white border-[#E2E8F0]' : 'bg-white/[0.02] border-white/10'
                }`}
              >
                <input
                  type="text"
                  value={newVendor.name}
                  onChange={(e) => setNewVendor({ ...newVendor, name: e.target.value })}
                  placeholder="Vendor name (required)"
                  className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                />
                <input
                  type="text"
                  value={newVendor.country}
                  onChange={(e) => setNewVendor({ ...newVendor, country: e.target.value })}
                  placeholder="Country (required) — e.g. USA"
                  className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                />
                <input
                  type="text"
                  value={newVendor.website}
                  onChange={(e) => setNewVendor({ ...newVendor, website: e.target.value })}
                  placeholder="Website (optional)"
                  className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingVendor(false);
                      setNewVendor({ name: '', country: '', website: '' });
                    }}
                    className={`text-xs font-medium px-2.5 py-1.5 rounded-md ${buttonSecondary}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddVendor}
                    disabled={!newVendor.name.trim() || !newVendor.country.trim()}
                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonPrimary}`}
                  >
                    Save vendor
                  </button>
                </div>
                <p className={`text-[11px] ${mutedColor}`}>
                  Vendor records are shared across PIQC Clinical · Audit users.
                </p>
              </div>
            )}
          </Field>

          {/* ----- Protocol ----- */}
          <div>
            <label className={`flex items-center gap-1.5 text-sm font-medium mb-2 ${labelColor}`}>
              <FileText size={12} className={mutedColor} />
              Protocol <span className="text-red-500 dark:text-red-400">*</span>
            </label>
            <div className={`border-b mb-3 ${isLight ? 'border-[#E2E8F0]' : 'border-white/5'}`}>
              <div className="flex gap-4">
                <ProtocolTabButton
                  active={protocolMode === 'existing'}
                  disabled={protocols.length === 0 || submitting}
                  onClick={() => setProtocolMode('existing')}
                  activeClass={tabActive}
                  inactiveClass={tabInactive}
                >
                  Pick from library {protocols.length > 0 && `(${protocols.length})`}
                </ProtocolTabButton>
                <ProtocolTabButton
                  active={protocolMode === 'upload'}
                  disabled={submitting}
                  onClick={() => setProtocolMode('upload')}
                  activeClass={tabActive}
                  inactiveClass={tabInactive}
                >
                  Upload new PDF
                </ProtocolTabButton>
              </div>
            </div>

            {protocolMode === 'existing' && (
              <div>
                {protocols.length === 0 ? (
                  <p className={`text-xs ${subColor} px-3 py-2`}>
                    Your protocol library is empty. Upload a PDF on the other tab.
                  </p>
                ) : (
                  <select
                    value={protocolVersionId}
                    onChange={(e) => setProtocolVersionId(e.target.value)}
                    className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                    disabled={submitting}
                  >
                    <option value="">Pick a protocol you've uploaded or audited…</option>
                    {protocols.map((p) => (
                      <option key={p.id} value={p.latest_version_id}>
                        {p.study_number ? `${p.study_number} — ` : ''}{p.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {protocolMode === 'upload' && (
              <div className="space-y-3">
                <label
                  className={`flex items-center justify-center gap-2 w-full px-3 py-4 rounded-md border border-dashed cursor-pointer transition-colors ${
                    isLight
                      ? 'border-[#CBD5E1] hover:border-[#02BBB8]/40 hover:bg-white text-[#334155]/75'
                      : 'border-white/15 hover:border-[#6FC9C7]/40 hover:bg-white/[0.03] text-[#CBD5E1]/70'
                  }`}
                >
                  <Upload size={14} className={mutedColor} />
                  <span className="text-sm">
                    {pdfFile ? pdfFile.name : 'Drop or pick the protocol PDF'}
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setPdfFile(f);
                      // A new file means a new upload — discard any cached
                      // document id from a previous attempt so submit re-uploads.
                      setUploadedDocumentId(null);
                      if (f && !pdfTitle) {
                        setPdfTitle(f.name.replace(/\.pdf$/i, ''));
                      }
                    }}
                    disabled={submitting}
                  />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={pdfTitle}
                    onChange={(e) => setPdfTitle(e.target.value)}
                    placeholder="Protocol title (required)"
                    className={`rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                    disabled={submitting}
                  />
                  <input
                    type="text"
                    value={pdfSponsor}
                    onChange={(e) => setPdfSponsor(e.target.value)}
                    placeholder="Sponsor (required)"
                    className={`rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                    disabled={submitting}
                  />
                  <input
                    type="text"
                    value={pdfStudyNumber}
                    onChange={(e) => setPdfStudyNumber(e.target.value)}
                    placeholder="Protocol / study number (optional)"
                    className={`rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                    disabled={submitting}
                  />
                  <div className="relative">
                    <select
                      value={pdfPhase}
                      onChange={(e) => setPdfPhase(e.target.value as ClinicalTrialPhase)}
                      className={`appearance-none w-full rounded-md border px-3 pr-8 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                      disabled={submitting}
                    >
                      {PHASE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <ChevronDown
                      size={12}
                      className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 ${mutedColor}`}
                    />
                  </div>
                </div>
                <p className={`text-[11px] ${mutedColor}`}>
                  The PDF is parsed by the PIQC engine so it becomes a structured protocol
                  you can audit against.
                </p>
                {/* Surfaces when a previous submit got past upload but failed
                    on a later step. The cached document id will be reused on
                    retry — no duplicate upload. Cleared when a new file is picked. */}
                {uploadedDocumentId && pdfFile && (
                  <p
                    data-testid="upload-cached-indicator"
                    className={`text-[11px] inline-flex items-center gap-1 ${
                      isLight ? 'text-[#02BBB8]' : 'text-[#6FC9C7]'
                    }`}
                  >
                    <CheckCircle2 size={11} />
                    PDF uploaded — retry will resume from the next step.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ----- Audit type + scheduled date ----- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Audit type" required labelColor={labelColor}>
              <div className="grid grid-cols-3 gap-1.5">
                {AUDIT_TYPES.map((t) => {
                  const active = auditType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setAuditType(t)}
                      disabled={submitting}
                      className={`text-center rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${
                        active
                          ? isLight
                            ? 'bg-[#02BBB8]/10 border-[#02BBB8] text-[#02BBB8]'
                            : 'bg-[#02BBB8]/15 border-[#6FC9C7] text-[#6FC9C7]'
                          : isLight
                            ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:border-[#CBD5E1]'
                            : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]/55 hover:border-white/20'
                      }`}
                    >
                      {AUDIT_TYPE_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Scheduled date" labelColor={labelColor}>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                disabled={submitting}
              />
            </Field>
          </div>

          {/* ----- Errors ----- */}
          {error && (
            <div
              role="alert"
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                isLight
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-red-500/[0.08] border-red-500/30 text-red-300'
              }`}
            >
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ----- Progress ----- */}
          {submitting && progressStep && (
            <div
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                isLight
                  ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]'
                  : 'bg-white/[0.04] border-white/10 text-[#CBD5E1]'
              }`}
            >
              <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span>{progressStep}</span>
            </div>
          )}
        </div>

        {/* Footer ----------------------------------------------------------- */}
        <div
          className={`sticky bottom-0 z-10 px-5 py-3 border-t backdrop-blur flex justify-end gap-2 ${
            isLight
              ? 'bg-[#F8FAFC]/95 border-[#E2E8F0]'
              : 'bg-[#020617]/95 border-white/5'
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={`text-sm font-medium px-3.5 py-2 rounded-md ${buttonSecondary} disabled:opacity-40`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonPrimary}`}
          >
            <CheckCircle2 size={13} />
            {submitting ? 'Creating…' : 'Create audit'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Field — labeled wrapper to keep input rows visually consistent.
// ============================================================================
function Field({
  label,
  required,
  labelColor,
  icon: Icon,
  children,
}: {
  label: string;
  required?: boolean;
  labelColor: string;
  icon?: typeof Building2;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={`flex items-center gap-1.5 text-sm font-medium mb-2 ${labelColor}`}>
        {Icon && <Icon size={12} className="text-fg-muted" />}
        {label}
        {required && <span className="text-red-500 dark:text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

// ============================================================================
// ProtocolTabButton — small tab affordance for the Existing/Upload toggle.
// ============================================================================
function ProtocolTabButton({
  active,
  disabled,
  onClick,
  activeClass,
  inactiveClass,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  activeClass: string;
  inactiveClass: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
        active ? activeClass : inactiveClass
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
