import type { DeliverableArtifactType } from '../../../types/deliverables';

// =============================================================================
// craDeliverables — the merged Protocol Intelligence workspace's deliverable
// picker order (formerly the CRA-only subset; formerly Sponsor's
// ARTIFACT_PICKER_ORDER in ProtocolIntelligenceTab.tsx before the 2026-08-02
// merge). Kept as a pure module (not an inline const in the shell) so the
// order is testable without rendering the component.
//
// Checklist leads (the default) — the most broadly-relevant "getting
// started" deliverable for either a monitor or a sponsor reviewer. All five
// types mount in the same shared DeliverablePanel via DELIVERABLE_CONFIGS.
// =============================================================================

export const CRA_ARTIFACT_ORDER: readonly DeliverableArtifactType[] = [
  'monitoring_prep_checklist',
  'risk_overview',
  'cra_monitoring_focus',
  'siv_package',
  'site_training_priorities',
];
