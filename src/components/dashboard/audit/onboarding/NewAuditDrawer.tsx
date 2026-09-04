import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Building2, FileText, Upload, ChevronDown, CheckCircle2, AlertTriangle, Stethoscope } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useOverlay } from '../../../../hooks/useOverlay';
import {
  listVendors,
  createVendor,
  listSites,
  createSite,
  listAuditorProtocolLibrary,
  uploadProtocolPdf,
  createProtocolFromDocument,
  createAudit,
  type VendorRow,
  type SiteRow,
  type AuditorProtocolRow,
} from '../../../../lib/audit/auditCreationApi';
import { AUDIT_TYPE_LABELS, AUDIT_WORKFLOW_TYPE_LABELS } from '../../../../lib/audit/labels';
import type { AuditType, AuditWorkflowType, ClinicalTrialPhase } from '../../../../types/audit';

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
  const [workflowType, setWorkflowType] = useState<AuditWorkflowType>('VENDOR_AUDIT');
  const [auditType, setAuditType] = useState<AuditType>('REMOTE');
  const [scheduledDate, setScheduledDate] = useState<string>('');
  const [scheduledEndDate, setScheduledEndDate] = useState<string>('');

  // Vendors (VENDOR_AUDIT auditee)
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [vendorId, setVendorId] = useState<string>('');
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendor, setNewVendor] = useState({ name: '', country: '', website: '' });
  const [vendorError, setVendorError] = useState<string | null>(null);

  // Sites (INVESTIGATOR_SITE_AUDIT auditee)
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState<string>('');
  const [addingSite, setAddingSite] = useState(false);
  const [newSite, setNewSite] = useState({ name: '', country: '', siteNumber: '', principalInvestigator: '' });
  const [siteError, setSiteError] = useState<string | null>(null);

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

  // Bootstrap load failure. Distinct from a genuinely empty library: an errored
  // fetch must not render as "no vendors / no protocols yet" — the auditor's
  // data is still there, we just couldn't reach it. Drives a retryable banner.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingPickers, setLoadingPickers] = useState(true);

  // ---------------------------------------------------------------------------
  // Bootstrap reads
  // ---------------------------------------------------------------------------
  const loadPickers = useCallback(async () => {
    setLoadingPickers(true);
    const [v, s, p] = await Promise.all([
      listVendors(),
      listSites(),
      listAuditorProtocolLibrary(),
    ]);
    // Any failed source → surface the reason, not a misleadingly-empty picker.
    // Keep the prior banner (if any) up until this attempt resolves, so a retry
    // never briefly reads as "loaded but empty."
    if (!v.ok || !s.ok || !p.ok) {
      setLoadError(
        (!v.ok && v.error) || (!s.ok && s.error) || (!p.ok && p.error) ||
        'Could not load vendors, sites, or protocols.',
      );
      setLoadingPickers(false);
      return;
    }
    setVendors(v.data);
    setSites(s.data);
    setProtocols(p.data);
    // If the auditor has no library yet, default to upload mode.
    if (p.data.length === 0) setProtocolMode('upload');
    setLoadError(null);
    setLoadingPickers(false);
  }, []);

  useEffect(() => {
    void loadPickers();
  }, [loadPickers]);

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
    ? 'border-[#CBD5E1] focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
    : 'border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-[#CBD5E1]'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-white/10 disabled:text-white/35';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';
  const tabActive = isLight ? 'border-brand-600 text-brand-600' : 'border-brand-300 text-brand-300';
  const tabInactive = isLight
    ? 'border-transparent text-[#334155]/60 hover:text-[#0F172A]'
    : 'border-transparent text-[#CBD5E1]/55 hover:text-white';

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const canSubmit = (() => {
    if (!auditName.trim()) return false;
    if (workflowType === 'VENDOR_AUDIT' && !vendorId) return false;
    if (workflowType === 'INVESTIGATOR_SITE_AUDIT' && !siteId) return false;
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
          setProgressStep('Uploading protocol PDF…');
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
      const result = await createAudit({
        auditName: auditName.trim(),
        workflowType,
        vendorId: workflowType === 'VENDOR_AUDIT' ? vendorId : null,
        siteId: workflowType === 'INVESTIGATOR_SITE_AUDIT' ? siteId : null,
        protocolVersionId: versionId,
        auditType,
        scheduledDate: scheduledDate || null,
        scheduledEndDate: scheduledEndDate || null,
      });
      // Surface the RPC's specific reason (bad auditee pairing, missing protocol
      // version, etc.) instead of a flat "Audit creation failed."
      if (!result.ok) throw new Error(result.error);
      const audit = result.data;

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
    setVendorError(null);
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
    } else {
      // createVendor degrades to null on failure (console.error'd in the API
      // layer) — surface one visible signal instead of silently doing nothing.
      setVendorError('Could not save the vendor. Try again.');
    }
  };

  const handleAddSite = async () => {
    if (!newSite.name.trim() || !newSite.country.trim()) return;
    setSiteError(null);
    const created = await createSite({
      name: newSite.name,
      country: newSite.country,
      siteNumber: newSite.siteNumber || undefined,
      principalInvestigator: newSite.principalInvestigator || undefined,
    });
    if (created) {
      setSites((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSiteId(created.id);
      setAddingSite(false);
      setNewSite({ name: '', country: '', siteNumber: '', principalInvestigator: '' });
    } else {
      // createSite degrades to null on failure (console.error'd in the API
      // layer) — surface one visible signal instead of silently doing nothing.
      setSiteError('Could not save the site. Try again.');
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
          {/* Bootstrap load failure — shown above the form so the empty pickers
              below read as "couldn't reach your data (retry)" rather than the
              genuine "you have none yet" empty state. */}
          {loadError && (
            <div
              role="alert"
              className={`flex items-start gap-3 rounded-md border px-3.5 py-3 ${
                isLight ? 'bg-rose-50 border-rose-200' : 'bg-rose-500/10 border-rose-500/30'
              }`}
            >
              <AlertTriangle
                size={16}
                className={`mt-0.5 shrink-0 ${isLight ? 'text-rose-600' : 'text-rose-300'}`}
              />
              <div className="flex-1 min-w-0">
                <p className={`${headingColor} text-sm font-semibold`}>
                  Couldn't load your vendors, sites, or protocols
                </p>
                <p className={`${subColor} text-xs mt-0.5`}>{loadError}</p>
              </div>
              <button
                type="button"
                onClick={() => { void loadPickers(); }}
                disabled={submitting || loadingPickers}
                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonSecondary}`}
              >
                {loadingPickers ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}

          {/* ----- Audit workflow -----
              Both workflows are live. The choice drives which auditee field
              renders below (vendor vs site) and is passed to createAudit, which
              lands the audit at the workflow's first stage. */}
          <Field label="Audit workflow" labelColor={labelColor}>
            {/* Toggle-button pair (aria-pressed), not a radiogroup — matches the
                house pattern for the Audit-type chips and the hub's workflow
                filter, and avoids promising arrow-key radio semantics the
                buttons don't implement. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <WorkflowCard
                icon={Building2}
                title={AUDIT_WORKFLOW_TYPE_LABELS.VENDOR_AUDIT}
                description="Audit a vendor — CRO, lab, ePRO, IRT — against a protocol."
                selected={workflowType === 'VENDOR_AUDIT'}
                onSelect={() => setWorkflowType('VENDOR_AUDIT')}
                isLight={isLight}
                disabled={submitting}
              />
              <WorkflowCard
                icon={Stethoscope}
                title={AUDIT_WORKFLOW_TYPE_LABELS.INVESTIGATOR_SITE_AUDIT}
                description="Audit an investigator site — protocol compliance, ICF, source data."
                selected={workflowType === 'INVESTIGATOR_SITE_AUDIT'}
                onSelect={() => setWorkflowType('INVESTIGATOR_SITE_AUDIT')}
                isLight={isLight}
                disabled={submitting}
              />
            </div>
          </Field>

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

          {/* ----- Auditee: vendor (vendor audit) or site (investigator site audit) ----- */}
          {workflowType === 'VENDOR_AUDIT' && (
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
                      setVendorError(null);
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
                {vendorError && (
                  <p role="alert" className={`text-[11px] ${isLight ? 'text-red-700' : 'text-red-300'}`}>
                    {vendorError}
                  </p>
                )}
                <p className={`text-[11px] ${mutedColor}`}>
                  Vendor records are shared across PIQC Clinical · Audit users.
                </p>
              </div>
            )}
          </Field>
          )}

          {workflowType === 'INVESTIGATOR_SITE_AUDIT' && (
          <Field label="Investigator site" required labelColor={labelColor} icon={Stethoscope}>
            {!addingSite ? (
              <div className="flex gap-2">
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                  disabled={submitting}
                >
                  <option value="">Pick the site you're auditing…</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.site_number ? ` · ${s.site_number}` : ''}
                      {s.country ? ` · ${s.country}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setAddingSite(true)}
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
                  value={newSite.name}
                  onChange={(e) => setNewSite({ ...newSite, name: e.target.value })}
                  placeholder="Site name (required)"
                  className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                />
                <input
                  type="text"
                  value={newSite.principalInvestigator}
                  onChange={(e) => setNewSite({ ...newSite, principalInvestigator: e.target.value })}
                  placeholder="Principal investigator (optional)"
                  className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newSite.siteNumber}
                    onChange={(e) => setNewSite({ ...newSite, siteNumber: e.target.value })}
                    placeholder="Site number (optional)"
                    className={`rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                  />
                  <input
                    type="text"
                    value={newSite.country}
                    onChange={(e) => setNewSite({ ...newSite, country: e.target.value })}
                    placeholder="Country (required) — e.g. USA"
                    className={`rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingSite(false);
                      setNewSite({ name: '', country: '', siteNumber: '', principalInvestigator: '' });
                      setSiteError(null);
                    }}
                    className={`text-xs font-medium px-2.5 py-1.5 rounded-md ${buttonSecondary}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddSite}
                    disabled={!newSite.name.trim() || !newSite.country.trim()}
                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonPrimary}`}
                  >
                    Save site
                  </button>
                </div>
                {siteError && (
                  <p role="alert" className={`text-[11px] ${isLight ? 'text-red-700' : 'text-red-300'}`}>
                    {siteError}
                  </p>
                )}
                <p className={`text-[11px] ${mutedColor}`}>
                  Site records are shared across PIQC Clinical · Audit users.
                </p>
              </div>
            )}
          </Field>
          )}

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
                {protocols.length === 0 && !loadError ? (
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
                      ? 'border-[#CBD5E1] hover:border-brand-600/40 hover:bg-white text-[#334155]/75'
                      : 'border-white/15 hover:border-brand-300/40 hover:bg-white/[0.03] text-[#CBD5E1]/70'
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
                  PIQC parses the PDF in the background after upload — Stage 1 of the new
                  audit shows the parse status and the extracted worksheet items.
                </p>
                {/* Surfaces when a previous submit got past upload but failed
                    on a later step. The cached document id will be reused on
                    retry — no duplicate upload. Cleared when a new file is picked. */}
                {uploadedDocumentId && pdfFile && (
                  <p
                    data-testid="upload-cached-indicator"
                    className={`text-[11px] inline-flex items-center gap-1 ${
                      isLight ? 'text-brand-600' : 'text-brand-300'
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
                            ? 'bg-brand-600/10 border-brand-600 text-brand-600'
                            : 'bg-brand-600/15 border-brand-300 text-brand-300'
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
                onChange={(e) => {
                  setScheduledDate(e.target.value);
                  // A window can't outlive its start — clearing the start
                  // clears the end (the RPC rejects end-without-start).
                  if (!e.target.value) setScheduledEndDate('');
                }}
                className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none`}
                disabled={submitting}
              />
            </Field>
            <Field label="End date" labelColor={labelColor}>
              <input
                type="date"
                value={scheduledEndDate}
                min={scheduledDate || undefined}
                onChange={(e) => setScheduledEndDate(e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none disabled:opacity-50`}
                disabled={submitting || !scheduledDate}
              />
              <p className={`mt-1 text-[11px] ${mutedColor}`}>
                Leave empty for a single-day audit.
              </p>
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
// WorkflowCard — selectable toggle card for the audit-workflow chooser.
// ============================================================================
function WorkflowCard({
  icon: Icon,
  title,
  description,
  selected,
  onSelect,
  isLight,
  disabled,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  isLight: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      disabled={disabled}
      className={`text-left rounded-md border px-3 py-2.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        selected
          ? isLight
            ? 'bg-brand-600/10 border-brand-600'
            : 'bg-brand-600/15 border-brand-300'
          : isLight
            ? 'bg-white border-[#E2E8F0] hover:border-[#CBD5E1]'
            : 'bg-white/[0.02] border-white/10 hover:border-white/20'
      }`}
    >
      <span
        className={`flex items-center gap-1.5 text-xs font-semibold ${
          selected ? (isLight ? 'text-brand-600' : 'text-brand-300') : 'text-fg-heading'
        }`}
      >
        <Icon size={12} />
        {title}
      </span>
      {/* text-fg-sub in both states — the description is what drives the
          choice, so it never drops to the lowest-contrast token. */}
      <span className="block text-[11px] mt-0.5 text-fg-sub">
        {description}
      </span>
    </button>
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
