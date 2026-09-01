import type { MockWorkspaceEntry } from './mockWorkspaceEntries';
import {
  PROVISIONAL_CLASSIFICATION_LABELS,
  PROVISIONAL_IMPACT_LABELS,
} from './labels';
import type { ProvisionalClassification } from '../../types/audit';

// =============================================================================
// observationGroups — the one grouping and ordering of Stage 6 workspace
// entries that every report surface renders (Stage 7 screen, Stage 8
// markdown export, Stage 8 docx export). Extracted from three
// hand-maintained copies that had already drifted.
//
// Pure module — no React, no Supabase.
//
// `number` is printed by the two EXPORT builders; the Stage 7 screen renders
// the same order inside a CSS-numbered <ol>, so its visible numbers coincide
// with `number` only as long as it renders every item of the group — filter
// on that surface and the screen and the exports will disagree.
//
// Deliberately NOT here: the group HEADING strings. The screen uses sentence
// case ("Opportunities for improvement"), the document exports use title
// case ("Opportunities for Improvement") — that is per-surface presentation,
// not shared logic. Each surface keeps its own label map; do not "fix" the
// casing difference by unifying them.
//
// NOT_YET_CLASSIFIED is excluded by design: unclassified entries never
// appear in a report body. The screen's "n not yet classified" warning
// derives its count directly from the entries array.
// =============================================================================

// Report section order — pinned. `satisfies` checks the members against the
// ProvisionalClassification union so a renamed enum value fails to compile.
export const REPORT_CLASSIFICATION_ORDER = [
  'FINDING',
  'OBSERVATION',
  'OPPORTUNITY_FOR_IMPROVEMENT',
] as const satisfies readonly ProvisionalClassification[];

export type ReportClassification = (typeof REPORT_CLASSIFICATION_ORDER)[number];

export interface ObservationBlock {
  /** 1-based within its group — restarts per group. */
  number: number;
  vendorDomain: string;
  impactLabel: string;
  classificationLabel: string;
  observationText: string;
  checkpointRef: string | null;
  /** The source entry, for surface-specific extras (Stage 7's linked-risk
   *  lookup reads protocol_risk_id off it). */
  entry: MockWorkspaceEntry;
}

export interface ObservationGroup {
  key: ReportClassification;
  items: ObservationBlock[];
}

export function buildObservationGroups(
  entries: MockWorkspaceEntry[],
): ObservationGroup[] {
  return REPORT_CLASSIFICATION_ORDER.map((key) => ({
    key,
    items: entries
      .filter((e) => e.provisional_classification === key)
      .map((e, i) => ({
        number: i + 1,
        vendorDomain: e.vendor_domain,
        impactLabel: PROVISIONAL_IMPACT_LABELS[e.provisional_impact],
        classificationLabel:
          PROVISIONAL_CLASSIFICATION_LABELS[e.provisional_classification],
        observationText: e.observation_text,
        checkpointRef: e.checkpoint_ref,
        entry: e,
      })),
  }));
}
