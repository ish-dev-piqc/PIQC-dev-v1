import type { DeliverableArtifactType } from '../../../types/deliverables';

// =============================================================================
// craDeliverables — the CRA/Monitor workspace's deliverable selection. Kept
// as a pure module (not an inline const in the shell) so the role-lens
// decision is testable without rendering the component, and so the shell's
// only export stays the component itself.
//
// The monitor's operational pair, focus first (the default): "where limited
// on-site attention goes" (cra_monitoring_focus) and "what to prep"
// (monitoring_prep_checklist). Risk overview and the SIV package are
// sponsor-facing and are deliberately absent — that subset IS the lens. All
// four types remain available on the Sponsor Protocol Intelligence tab.
// =============================================================================

export const CRA_ARTIFACT_ORDER: readonly DeliverableArtifactType[] = [
  'cra_monitoring_focus',
  'monitoring_prep_checklist',
];
