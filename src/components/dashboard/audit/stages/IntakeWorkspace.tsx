import ProtocolRiskTagging from './intake/ProtocolRiskTagging';
import StageTransitionCard from './StageTransitionCard';

// =============================================================================
// IntakeWorkspace — INTAKE stage center pane (vendor workflow)
//
// The auditor tags the protocol sections the vendor is responsible for. Each
// tagged section anchors downstream criticality scoring, questionnaire
// addenda, and the risk summary. The flow itself — PIQC candidates from the
// parsed protocol, manual tagging, PIQC-assisted accept with provenance,
// edit, delete, history — lives in ProtocolRiskTagging, shared with the
// investigator site workflow's Risk assessment stage; this workspace owns the
// stage header, mounts the parse-status card, and ends with the stage
// transition (ungated: Intake → Vendor enrichment is +1 with no server gate).
// =============================================================================

export default function IntakeWorkspace() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          Stage 1 · Intake
        </p>
        <h2 className="text-fg-heading text-xl font-semibold mt-1">
          Protocol section tagging
        </h2>
        <p className="text-fg-sub text-sm mt-1.5 leading-relaxed max-w-2xl">
          Tag every protocol section your vendor is responsible for. The endpoint tier,
          impact surface, and operational domain you record here anchor criticality
          scoring, questionnaire addenda, and the risk summary downstream.
        </p>
      </div>

      <ProtocolRiskTagging workflow="VENDOR_AUDIT" showReadinessCard />

      {/* Stays visible while the tagging form above is open — the form hides
          its own panels, not the page — same as Scope review's card. */}
      <StageTransitionCard stage="INTAKE" nextStage="VENDOR_ENRICHMENT" />
    </div>
  );
}
