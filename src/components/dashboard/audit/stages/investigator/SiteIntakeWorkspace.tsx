import { Stethoscope, User, MapPin, Hash, FileText, FlaskConical, ArrowRight } from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import { useAudit } from '../../../../../context/AuditContext';
import { AUDIT_TYPE_LABELS, CLINICAL_TRIAL_PHASE_LABELS, STAGE_LABELS } from '../../../../../lib/audit/labels';
import ProtocolReadinessCard from '../ProtocolReadinessCard';

// =============================================================================
// SiteIntakeWorkspace — ISA_SITE_INTAKE stage center pane
//
// First stage of the Investigator Site Audit workflow. Confirms the site, PI,
// and protocol under audit — the anchor for the risk assessment that follows.
// Phase 1 is a read-only profile summary sourced from AuditContext (site joined
// on the audit); auditor-editable site context + the auditor-independence
// attestation (which gates the report export) land in later phases.
// =============================================================================

export default function SiteIntakeWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  if (!activeAudit) return null;

  const cardBase = isLight
    ? 'bg-white border-[#E2E8F0]'
    : 'bg-white/[0.02] border-white/10';
  const rowBorder = isLight ? 'border-[#EEF2F6]' : 'border-white/5';

  const siteRows: { icon: typeof User; label: string; value: string }[] = [
    { icon: Hash, label: 'Site number', value: activeAudit.site_number || '—' },
    { icon: User, label: 'Principal investigator', value: activeAudit.principal_investigator || '—' },
    { icon: MapPin, label: 'Country', value: activeAudit.site_country || '—' },
  ];

  const protocolRows: { icon: typeof FileText; label: string; value: string }[] = [
    // The study-number row renders only when one exists — otherwise the Title
    // row already carries the protocol's identity and the two would duplicate.
    ...(activeAudit.protocol_code
      ? [{ icon: FileText, label: 'Protocol', value: activeAudit.protocol_code }]
      : []),
    { icon: FileText, label: 'Title', value: activeAudit.protocol_title || '—' },
    { icon: FlaskConical, label: 'Phase', value: CLINICAL_TRIAL_PHASE_LABELS[activeAudit.clinical_trial_phase] },
    { icon: Stethoscope, label: 'Audit type', value: AUDIT_TYPE_LABELS[activeAudit.audit_type] },
  ];

  return (
    // Container + type scale match the vendor stage workspaces (p-6 max-w-4xl,
    // text-xl heading) so the two pipelines read as siblings in the same shell.
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          Stage 1 · Site intake
        </p>
        <h2 className="text-fg-heading text-xl font-semibold mt-1">
          Confirm the site under audit
        </h2>
        <p className="text-fg-sub text-sm mt-1.5 leading-relaxed max-w-2xl">
          Review the site, investigator, and protocol this audit covers. They anchor the
          risk-based scope the next stage generates.
        </p>
      </div>

      {/* Site profile */}
      <section className={`rounded-lg border ${cardBase}`}>
        <div className={`flex items-center gap-2 px-4 py-3 border-b ${rowBorder}`}>
          <Stethoscope size={15} className={isLight ? 'text-brand-600' : 'text-brand-300'} />
          <h3 className="text-fg-heading text-sm font-semibold">{activeAudit.auditee_name || 'Investigator site'}</h3>
        </div>
        <dl>
          {siteRows.map(({ icon: Icon, label, value }) => (
            <div key={label} className={`flex items-center gap-3 px-4 py-2.5 border-t ${rowBorder} first:border-t-0`}>
              <Icon size={13} className="text-fg-muted flex-shrink-0" />
              <dt className="text-fg-label text-xs w-40 flex-shrink-0">{label}</dt>
              <dd className="text-fg-body text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Protocol under audit */}
      <section className={`rounded-lg border ${cardBase}`}>
        <div className={`flex items-center gap-2 px-4 py-3 border-b ${rowBorder}`}>
          <FileText size={15} className={isLight ? 'text-brand-600' : 'text-brand-300'} />
          <h3 className="text-fg-heading text-sm font-semibold">Protocol under audit</h3>
        </div>
        <dl>
          {protocolRows.map(({ icon: Icon, label, value }) => (
            <div key={label} className={`flex items-center gap-3 px-4 py-2.5 border-t ${rowBorder} first:border-t-0`}>
              <Icon size={13} className="text-fg-muted flex-shrink-0" />
              <dt className="text-fg-label text-xs w-40 flex-shrink-0">{label}</dt>
              <dd className="text-fg-body text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Parse status of that protocol + the guarded upload path. The rows
          above stay read-only; the card owns everything about the document. */}
      <ProtocolReadinessCard />

      {/* Next-stage hint */}
      <div
        className={`flex items-center gap-2 rounded-md border px-4 py-3 text-sm ${
          isLight ? 'bg-brand-600/[0.06] border-brand-600/20 text-fg-body' : 'bg-brand-300/[0.06] border-brand-300/20 text-fg-body'
        }`}
      >
        <ArrowRight size={14} className={`flex-shrink-0 ${isLight ? 'text-brand-600' : 'text-brand-300'}`} />
        <span>
          Next: <span className="font-medium text-fg-heading">{STAGE_LABELS.ISA_RISK_ASSESSMENT}</span> —
          derive protocol and site risk to drive the audit scope.
        </span>
      </div>
    </div>
  );
}
