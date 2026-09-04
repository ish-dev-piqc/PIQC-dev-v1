import { ArrowRight } from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import { useAudit } from '../../../../../context/AuditContext';
import { STAGE_LABELS } from '../../../../../lib/audit/labels';
import ProtocolRiskTagging from '../intake/ProtocolRiskTagging';

// =============================================================================
// IsaRiskAssessmentWorkspace — ISA_RISK_ASSESSMENT stage center pane
//
// Second stage of the Investigator Site Audit workflow: the auditor tags the
// protocol sections that carry risk at this site — the same protocol-risk
// flow as the vendor Intake stage (ProtocolRiskTagging), because protocol
// risks belong to the protocol version, not the auditee. On the site
// workflow the vendor axis (operational domain, vendor dependency flags) is
// hidden and eligibility criteria join the PIQC candidates. Site modules and
// their derived criticality land on the mapping that follows
// (isa-site-modules); the parse-status card stays on Stage 1.
//
// No stage-preview gate here, deliberately. ISA stage advancement is
// fail-closed by design (20260719000000: audit_mode_advance_audit_stage has
// no ISA ordering yet), so every ISA audit sits at ISA_SITE_INTAKE and this
// stage is only ever reached as the nav's one-ahead view. Gating on
// hasReachedStage would make the stage inert. What the flow writes is
// version-scoped protocol data the vendor workflow already writes ungated at
// its own first stage — not audit stage state. Revisit when the ISA advance
// path lands (see plans/sixonelabs-piqc/isa-risk-tagging.md).
// =============================================================================

export default function IsaRiskAssessmentWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  if (!activeAudit) return null;

  return (
    // Container + type scale match the vendor stage workspaces (p-6 max-w-4xl,
    // text-xl heading) so the two pipelines read as siblings in the same shell.
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          Stage 2 · Risk assessment
        </p>
        <h2 className="text-fg-heading text-xl font-semibold mt-1">
          Assess protocol risk for this site
        </h2>
        <p className="text-fg-sub text-sm mt-1.5 leading-relaxed max-w-2xl">
          Tag the protocol sections that carry risk at {activeAudit.auditee_name || 'this site'} —
          endpoints, dosing, the visit schedule, eligibility. PIQC proposes them from the parsed
          protocol; you confirm each one. Site modules and the risk-based scope build on these
          sections in the next stages.
        </p>
      </div>

      <ProtocolRiskTagging workflow="INVESTIGATOR_SITE_AUDIT" showReadinessCard={false} />

      {/* Next-stage hint */}
      <div
        className={`flex items-center gap-2 rounded-md border px-4 py-3 text-sm ${
          isLight ? 'bg-brand-600/[0.06] border-brand-600/20 text-fg-body' : 'bg-brand-300/[0.06] border-brand-300/20 text-fg-body'
        }`}
      >
        <ArrowRight size={14} className={`flex-shrink-0 ${isLight ? 'text-brand-600' : 'text-brand-300'}`} />
        <span>
          Next: <span className="font-medium text-fg-heading">{STAGE_LABELS.ISA_SCOPE_BUILDER}</span> —
          map these sections to site audit modules and generate the checklist.
        </span>
      </div>
    </div>
  );
}
