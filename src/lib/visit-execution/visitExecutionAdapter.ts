// =============================================================================
// Visit Execution Workspace — pure adapter.
//
// Maps ProtocolVisitTemplate[] (from src/lib/site/types.ts, Kiara-owned —
// type-only import, no API/context import) into VisitExecutionWorkspace[].
//
// Sprint 1 honesty: the existing protocol_visit_templates.procedures column
// is TEXT[]. We have no structured phase / classification / conditional / timing
// data in the schema yet. So this adapter produces a thin, accurate mapping —
// flat items with phase = 'assessment' and classification = 'required' as
// defaults, plus heuristic flag derivation for is_dosing_visit.
//
// Rich Sprint 1 workspace data (phase groupings, conditional rules, timing
// constraints, source field scaffolds) comes from the mock fixture behind
// the piq-visit-execution-mock-v1 localStorage toggle — see
// mockVisitWorkspace.ts.
//
// Pure: no Supabase, no fetch, no side effects. Easy to test.
// =============================================================================

import type { ProtocolVisitTemplate, VisitCrossReference } from '../site/types';
import type {
  VisitExecutionItem,
  VisitExecutionWorkspace,
  VisitSnapshot,
} from '../../types/visit-execution';


// ---------------------------------------------------------------------------
// Dosing-visit heuristic. Scans procedure strings for terms that strongly
// indicate IMP / dose administration. Not perfect — Sprint 2 should add an
// explicit boolean to the ingest schema or to protocol_visit_templates.
// ---------------------------------------------------------------------------

const DOSING_PATTERNS = /\b(dose|dosing|imp|infusion|administration|study drug|dispensation|dispens)\b/i;

function detectDosingVisit(procedures: string[]): boolean {
  return procedures.some((p) => DOSING_PATTERNS.test(p));
}


// ---------------------------------------------------------------------------
// Map one cross-reference (visit-level, already in DB) onto a per-item
// traceability seed. Used only when a procedure has no item-specific
// traceability — at minimum we surface what we have.
// ---------------------------------------------------------------------------

function pickVisitLevelCrossRef(
  refs: VisitCrossReference[],
): {
  cross_reference_source_section: string | null;
  cross_reference_page: number | null;
  cross_reference_snippet: string | null;
} {
  if (refs.length === 0) {
    return {
      cross_reference_source_section: null,
      cross_reference_page: null,
      cross_reference_snippet: null,
    };
  }
  const first = refs[0];
  return {
    cross_reference_source_section: first.source_section ?? null,
    cross_reference_page: first.page ?? null,
    cross_reference_snippet: first.snippet ?? null,
  };
}


// ---------------------------------------------------------------------------
// Map one ProtocolVisitTemplate to a VisitExecutionWorkspace. Items default
// to assessment / required — the most honest mapping the schema supports
// today.
// ---------------------------------------------------------------------------

export function adaptVisitTemplate(template: ProtocolVisitTemplate): VisitExecutionWorkspace {
  const visitCrossRef = pickVisitLevelCrossRef(template.cross_references ?? []);

  const items: VisitExecutionItem[] = (template.procedures ?? []).map((procedure, index) => ({
    id: `${template.id}-item-${index.toString().padStart(2, '0')}`,
    extracted_item_id: null,
    label: procedure,
    // Sprint 4b: thin-adapter rows have no separately-tracked derived_text;
    // label === procedure === the parser's flat string. No drift possible.
    derived_text: procedure,
    description: null,
    phase: 'assessment',
    classification: 'required',
    conditions: [],
    timing: null,
    source_fields: [],
    role_hint: null,
    traceability: {
      soa_column: null,
      protocol_section: null,
      protocol_page: null,
      amendment_version: null,
      source_evidence_id: null,
      ...visitCrossRef,
    },
    review_status: 'not_reviewed',
    review_note: null,
    // No extracted_item linked in the thin adapter path; confidence is unknown.
    // Sprint 3.5b populates real confidence_state via the v2 RPC, not this code path.
    confidence_state: null,
  }));

  const is_dosing_visit = detectDosingVisit(template.procedures ?? []);

  const snapshot: VisitSnapshot = {
    visit_name: template.visit_name,
    study_day: template.study_day,
    window_minus_days: template.window_minus_days,
    window_plus_days: template.window_plus_days,
    purpose:
      'Per-protocol visit. Detailed execution requirements pending structured ingest extraction.',
    is_dosing_visit,
    has_primary_endpoint: false,
    has_safety_critical: false,
    item_count: items.length,
    conditional_item_count: 0,
    endpoint_critical_count: 0,
    needs_review_count: 0,
    reviewed_count: 0,
    flagged_count: 0,
    amendment_version: null,
    // Sprint 3.5a additions. The thin adapter has no parser confidence to
    // report and no detected gaps — those come from the v2 RPC once
    // Sprint 3.5b ingest populates the new tables.
    confidence_state: null,
    completeness_signal_count: 0,
    completeness_signals: [],
  };

  return {
    visit_template_id: template.id,
    protocol_id: template.protocol_id,
    snapshot,
    items,
  };
}


// ---------------------------------------------------------------------------
// Batch adapter — used by visitExecutionApi.fetchVisitExecutionWorkspaces
// when the mock toggle is off. Sorts visits by study_day ascending so the
// navigator always presents Screening → Baseline → follow-ups in order.
// ---------------------------------------------------------------------------

export function adaptVisitTemplates(
  templates: ProtocolVisitTemplate[],
): VisitExecutionWorkspace[] {
  return [...templates]
    .sort((a, b) => a.study_day - b.study_day)
    .map(adaptVisitTemplate);
}
