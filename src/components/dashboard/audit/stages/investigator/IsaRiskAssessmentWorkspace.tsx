import { useAudit } from '../../../../../context/AuditContext';
import { hasReachedStage } from '../../../../../lib/audit/workflowStages';
import StagePreviewNotice from '../../StagePreviewNotice';
import StageTransitionCard from '../StageTransitionCard';
import ProtocolRiskTagging from '../intake/ProtocolRiskTagging';
import SiteModuleMappingPanel from './SiteModuleMappingPanel';

// =============================================================================
// IsaRiskAssessmentWorkspace — ISA_RISK_ASSESSMENT stage center pane
//
// Second stage of the Investigator Site Audit workflow: the auditor tags the
// protocol sections that carry risk at this site — the same protocol-risk
// flow as the vendor Intake stage (ProtocolRiskTagging), because protocol
// risks belong to the protocol version, not the auditee. On the site
// workflow the vendor axis (operational domain, vendor dependency flags) is
// hidden and eligibility criteria join the PIQC candidates. Under the flow,
// SiteModuleMappingPanel maps each tagged risk to the site audit modules it
// lands in, with the criticality derived server-side (isa-site-modules);
// the Scope builder rolls those up next, and the stage ends with the shared
// StageTransitionCard that advances into it (isa-scope-builder). The
// parse-status card stays on Stage 1.
//
// House preview gate (isa-stage-advance). Site intake now advances through
// audit_mode_advance_isa_stage, so this stage is reached for real; viewed one
// ahead (the nav's preview) it shows StagePreviewNotice and the tagging flow
// runs read-only — no Tag button, Accept disabled, no Edit/Delete. Tagged
// rows and History stay visible: they are version-scoped protocol data, not
// audit stage state. (isa-risk-tagging shipped this stage ungated because
// nothing could reach it yet; that reason is gone.)
// =============================================================================

export default function IsaRiskAssessmentWorkspace() {
  const { activeAudit } = useAudit();

  if (!activeAudit) return null;

  const hasReached = hasReachedStage(
    activeAudit.workflow_type,
    activeAudit.current_stage,
    'ISA_RISK_ASSESSMENT',
  );

  return (
    // Container + type scale match the vendor stage workspaces (p-6 max-w-4xl,
    // text-xl heading) so the two pipelines read as siblings in the same shell.
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {!hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}

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

      <ProtocolRiskTagging
        workflow="INVESTIGATOR_SITE_AUDIT"
        showReadinessCard={false}
        readOnly={!hasReached}
      />

      <SiteModuleMappingPanel readOnly={!hasReached} />

      <StageTransitionCard stage="ISA_RISK_ASSESSMENT" nextStage="ISA_SCOPE_BUILDER" />
    </div>
  );
}
