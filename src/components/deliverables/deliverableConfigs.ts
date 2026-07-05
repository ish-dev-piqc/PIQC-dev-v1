import {
  CRA_FOCUS_SECTION_LABELS,
  CRA_FOCUS_SECTION_ORDER,
  MONITORING_SECTION_LABELS,
  MONITORING_SECTION_ORDER,
  RISK_SECTION_LABELS,
  RISK_SECTION_ORDER,
  SITE_TRAINING_SECTION_LABELS,
  SITE_TRAINING_SECTION_ORDER,
  SIV_SECTION_LABELS,
  SIV_SECTION_ORDER,
  type DeliverableArtifactType,
} from '../../types/deliverables';

// =============================================================================
// deliverableConfigs — the per-artifact section vocabulary + export capability
// for <DeliverablePanel/>. Shared by every surface that mounts the panel (the
// Sponsor Protocol Intelligence tab and the CRA Monitoring Workspace), so the
// section order/labels and the "does this type export" answer live in exactly
// one place.
//
// The Record<DeliverableArtifactType, ...> shape is load-bearing: it FORCES a
// config entry for every artifact type at compile time. A new artifact type
// won't typecheck until it is described here — the exhaustive-map discipline
// the engine leans on (a hand-listed object would silently go stale).
//
// exportEnabled: all five deliverables export to a DRAFT PDF — the four
// portrait types through the config-driven buildDeliverablePdf, the SIV package
// through its own landscape deck builder. (Export vocabulary per type lives in
// src/lib/deliverables/deliverableExportConfig.)
// =============================================================================

export interface DeliverablePanelConfig {
  sectionOrder: readonly string[];
  sectionLabels: Record<string, string>;
  exportEnabled: boolean;
}

export const DELIVERABLE_CONFIGS: Record<DeliverableArtifactType, DeliverablePanelConfig> = {
  monitoring_prep_checklist: {
    sectionOrder: MONITORING_SECTION_ORDER,
    sectionLabels: MONITORING_SECTION_LABELS,
    exportEnabled: true,
  },
  risk_overview: {
    sectionOrder: RISK_SECTION_ORDER,
    sectionLabels: RISK_SECTION_LABELS,
    exportEnabled: true,
  },
  cra_monitoring_focus: {
    sectionOrder: CRA_FOCUS_SECTION_ORDER,
    sectionLabels: CRA_FOCUS_SECTION_LABELS,
    exportEnabled: true,
  },
  siv_package: {
    sectionOrder: SIV_SECTION_ORDER,
    sectionLabels: SIV_SECTION_LABELS,
    exportEnabled: true,
  },
  site_training_priorities: {
    sectionOrder: SITE_TRAINING_SECTION_ORDER,
    sectionLabels: SITE_TRAINING_SECTION_LABELS,
    exportEnabled: true,
  },
};
