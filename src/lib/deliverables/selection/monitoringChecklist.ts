// =============================================================================
// Protocol Deliverable Engine — Monitoring Preparation Checklist selection.
//
// Pure deterministic ruleset: takes already-extracted protocol facts (SOTR's
// protocol_extracted_items joined to their primary evidence) plus the
// protocol cohort list, and produces the ordered NewBlockSpec[] for a
// monitoring_prep_checklist artifact. No I/O, no side effects, never throws.
//
// This module is the unit-tested SPEC for the deliverable_generate RPC — the
// SQL port implements exactly these rules. Change rules here first, keep the
// tests green, then mirror in the migration.
//
// Content-origin discipline (the 3-way taxonomy — never blurred):
// - protocol_fact blocks ALWAYS carry extracted_item_id + evidence
//   passthrough + a confidence_state (missing item confidence degrades to
//   'needs_review', never to a silent null).
// - derived_operational_framing blocks NEVER carry evidence or confidence —
//   framing must not claim false provenance.
// - human_editorial is never emitted here; humans add those blocks later.
//
// Section emission policy:
// - Sections 1/3/4 emit nothing when the protocol has no matching facts
//   (empty sections are hidden by groupBlocksBySection downstream).
// - Sections 2/6/8 always say something: explicit coverage-gap / fallback
//   framing blocks instead of silence.
// - Section 5 emits only when at least one usable cohort exists.
// - Sections 7/9 are framing-only and always emit.
//
// Sensitive: quoted_text flows through as source_quote — never log it.
// =============================================================================

import type {
  MonitoringChecklistSectionKey,
  DeliverableBlockType,
  DeliverableContentOrigin,
  DeliverableConfidenceState,
} from '../../../types/deliverables';

// -----------------------------------------------------------------------------
// Input contract — shared by the generate flow and the tests. Deliberately
// minimal and self-contained: no imports from src/types/sotr or
// src/types/visit-execution (clients read server-denormalized shapes only).
// -----------------------------------------------------------------------------

/** One protocol_extracted_items row + its primary evidence, denormalized. */
export interface SelectionSourceItem {
  id: string;
  /** Persisted SOTR field_type: 'inclusion_criterion' | 'exclusion_criterion'
   *  | 'prohibited_med' | 'endpoint' | 'visit' | 'dosing' | 'metadata'
   *  | 'other'. Kept as string — unknown values are simply not selected. */
  field_type: string;
  /** e.g. 'primary_endpoints[0]', 'schedule_of_events[2]', 'amendment_summary'. */
  field_path: string;
  /** Criteria/endpoints/dosing: string. Visit: object (visit_name, study_day,
   *  window_minus_days, window_plus_days, procedures). Metadata: scalar.
   *  Treated as untrusted — every read is defensive. */
  extracted_value: unknown;
  confidence_state: 'high' | 'medium' | 'low' | 'needs_review' | null;
  primary_evidence: {
    id: string;
    /** SENSITIVE — never log. */
    quoted_text: string | null;
    page_number: number | null;
    section_title: string | null;
  } | null;
}

/** Minimal protocol_cohorts mirror (see ProtocolCohort in types/visit-execution). */
export interface SelectionCohort {
  label: string;
  dose_regimen: string | null;
  description: string | null;
}

export interface SelectionInput {
  items: SelectionSourceItem[];
  cohorts: SelectionCohort[];
  /** Stamped onto rows by the caller; the Phase-1 rules do not consume it. */
  protocolVersion: string | null;
}

/** A block ready for insertion into protocol_deliverable_blocks. */
export interface NewBlockSpec {
  section_key: MonitoringChecklistSectionKey;
  block_type: DeliverableBlockType;
  content_origin: DeliverableContentOrigin;
  derived_text: string;
  extracted_item_id: string | null;
  source_evidence_id: string | null;
  /** SENSITIVE — never log. */
  source_quote: string | null;
  source_page_number: number | null;
  source_section: string | null;
  confidence_state: DeliverableConfidenceState | null;
  sort_order: number;
}

// -----------------------------------------------------------------------------
// Defensive value readers — extracted_value comes from a jsonb column; treat
// every shape as hostile. Bad values skip the item, never throw.
// -----------------------------------------------------------------------------

// KEEP IN SYNC with selection/riskOverview.ts — the defensive readers below
// are duplicated there (this file is frozen post-merge; edits must land in
// both).
function asTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

interface VisitValue {
  visit_name: string;
  study_day: number | null;
  window_minus_days: number;
  window_plus_days: number;
  procedures: string[];
}

/** Normalizes a 'visit' extracted_value. Returns null (skip) when the value
 *  is not an object or has no usable visit_name — a nameless visit cannot
 *  produce meaningful checklist prose. Windows default to 0; a non-array
 *  procedures field degrades to []. */
function readVisitValue(v: unknown): VisitValue | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const rec = v as Record<string, unknown>;
  const name = asTrimmedString(rec.visit_name);
  if (!name) return null;
  const procedures = Array.isArray(rec.procedures)
    ? rec.procedures
        .map((p) => asTrimmedString(p))
        .filter((p): p is string => p !== null)
    : [];
  return {
    visit_name: name,
    study_day: asFiniteNumber(rec.study_day),
    window_minus_days: asFiniteNumber(rec.window_minus_days) ?? 0,
    window_plus_days: asFiniteNumber(rec.window_plus_days) ?? 0,
    procedures,
  };
}

// -----------------------------------------------------------------------------
// Section 6 heuristic — keyword categories over visit procedures.
// Vendor is checked FIRST: its keywords are the most specific ('central lab'
// would otherwise be shadowed by the specimen 'lab' keyword), then imaging,
// then specimen. Word-boundary patterns avoid false hits like the 'lab' in
// 'available'. Input is lowercased before matching.
// -----------------------------------------------------------------------------

type ProcedureCategory = 'specimen' | 'imaging' | 'vendor';

// KEEP IN SYNC with selection/riskOverview.ts — the keyword taxonomy below
// (vendor > imaging > specimen, word-boundary regexes) is duplicated there.
const VENDOR_PATTERNS: readonly RegExp[] = [
  /\bvendor\b/, /\bcentral lab/, /\bcourier\b/, /\bshipment\b/,
];
const IMAGING_PATTERNS: readonly RegExp[] = [
  /\becg\b/, /\bimaging\b/, /\bmri\b/, /\bct\b/, /\bx-ray\b/, /\bscan/, /\becho/,
];
const SPECIMEN_PATTERNS: readonly RegExp[] = [
  /\blabs?\b/, /\blaboratory\b/, /\bblood\b/, /\bserum\b/, /\bplasma\b/,
  /\burine\b/, /\bspecimens?\b/, /\bsamples?\b/,
];

function categorizeProcedure(procedure: string): ProcedureCategory | null {
  const lower = procedure.toLowerCase();
  if (VENDOR_PATTERNS.some((p) => p.test(lower)))   return 'vendor';
  if (IMAGING_PATTERNS.some((p) => p.test(lower)))  return 'imaging';
  if (SPECIMEN_PATTERNS.some((p) => p.test(lower))) return 'specimen';
  return null;
}

// -----------------------------------------------------------------------------
// Block emitters — the only two ways a block is born, so the content-origin
// discipline is structural, not conventional.
// -----------------------------------------------------------------------------

interface EmitState {
  blocks: NewBlockSpec[];
  nextSortOrder: number;
}

function pushFraming(
  state: EmitState,
  sectionKey: MonitoringChecklistSectionKey,
  blockType: DeliverableBlockType,
  text: string,
): void {
  state.blocks.push({
    section_key: sectionKey,
    block_type: blockType,
    content_origin: 'derived_operational_framing',
    derived_text: text,
    extracted_item_id: null,
    source_evidence_id: null,
    source_quote: null,
    source_page_number: null,
    source_section: null,
    confidence_state: null,
    sort_order: state.nextSortOrder++,
  });
}

function pushFact(
  state: EmitState,
  sectionKey: MonitoringChecklistSectionKey,
  item: SelectionSourceItem,
  text: string,
  forcedConfidence?: DeliverableConfidenceState,
): void {
  state.blocks.push({
    section_key: sectionKey,
    block_type: 'checklist_item',
    content_origin: 'protocol_fact',
    derived_text: text,
    extracted_item_id: item.id,
    source_evidence_id: item.primary_evidence?.id ?? null,
    source_quote: item.primary_evidence?.quoted_text ?? null,
    source_page_number: item.primary_evidence?.page_number ?? null,
    source_section: item.primary_evidence?.section_title ?? null,
    confidence_state: forcedConfidence ?? item.confidence_state ?? 'needs_review',
    sort_order: state.nextSortOrder++,
  });
}

// -----------------------------------------------------------------------------
// The ruleset
// -----------------------------------------------------------------------------

/**
 * Selects the draft Monitoring Preparation Checklist blocks from extracted
 * protocol facts. Pure function — no I/O, deterministic, never throws.
 * Emission order follows MONITORING_SECTION_ORDER; sort_order is a single
 * globally increasing sequence (0-based) over the emitted blocks.
 */
export function selectMonitoringChecklistBlocks(input: SelectionInput): NewBlockSpec[] {
  const state: EmitState = { blocks: [], nextSortOrder: 0 };

  // Pre-scan the item pools each section selects from (input order preserved).
  const inclusionItems = input.items
    .map((item) => ({ item, text: item.field_type === 'inclusion_criterion' ? asTrimmedString(item.extracted_value) : null }))
    .filter((e): e is { item: SelectionSourceItem; text: string } => e.text !== null);

  const exclusionItems = input.items
    .map((item) => ({ item, text: item.field_type === 'exclusion_criterion' ? asTrimmedString(item.extracted_value) : null }))
    .filter((e): e is { item: SelectionSourceItem; text: string } => e.text !== null);

  const prohibitedMedItems = input.items
    .map((item) => ({ item, text: item.field_type === 'prohibited_med' ? asTrimmedString(item.extracted_value) : null }))
    .filter((e): e is { item: SelectionSourceItem; text: string } => e.text !== null);

  const visitItems = input.items
    .map((item) => ({ item, visit: item.field_type === 'visit' ? readVisitValue(item.extracted_value) : null }))
    .filter((e): e is { item: SelectionSourceItem; visit: VisitValue } => e.visit !== null);

  const endpointItems = input.items
    .map((item) => ({ item, text: item.field_type === 'endpoint' ? asTrimmedString(item.extracted_value) : null }))
    .filter((e): e is { item: SelectionSourceItem; text: string } => e.text !== null);

  const cohorts = input.cohorts
    .map((cohort) => ({ cohort, label: asTrimmedString(cohort.label) }))
    .filter((e): e is { cohort: SelectionCohort; label: string } => e.label !== null);

  const amendmentEntry = input.items
    .map((item) => ({
      item,
      text:
        item.field_type === 'metadata' && item.field_path === 'amendment_summary'
          ? asTrimmedString(item.extracted_value)
          : null,
    }))
    .find((e): e is { item: SelectionSourceItem; text: string } => e.text !== null) ?? null;

  // --- 1. eligibility_verification (facts; empty when nothing extracted) ----
  if (inclusionItems.length > 0) {
    pushFraming(
      state, 'eligibility_verification', 'section_intro',
      'Verify each enrolled participant against the inclusion criteria below. ' +
      'Confirm source documentation supports every criterion at the time of enrollment.',
    );
    for (const { item, text } of inclusionItems) {
      pushFact(state, 'eligibility_verification', item, `Verify: ${text}`);
    }
  }

  // --- 2. exclusion_prohibited_med_review (facts; gap block ONLY when zero
  //     prohibited_med facts — absence of extraction ≠ absence of restrictions,
  //     so the section never goes silent on medications) ---------------------
  pushFraming(
    state, 'exclusion_prohibited_med_review', 'section_intro',
    'Confirm no enrolled participant meets an exclusion criterion below, and ' +
    'review medication history against protocol restrictions.',
  );
  for (const { item, text } of exclusionItems) {
    pushFact(state, 'exclusion_prohibited_med_review', item, `Confirm absence of: ${text}`);
  }
  for (const { item, text } of prohibitedMedItems) {
    pushFact(
      state, 'exclusion_prohibited_med_review', item,
      `Confirm absence of prohibited medication: ${text} — cross-check the ` +
      "participant's medication history.",
    );
  }
  if (prohibitedMedItems.length === 0) {
    pushFraming(
      state, 'exclusion_prohibited_med_review', 'checklist_item',
      'No prohibited-medication list was extracted from this protocol. Review the ' +
      'concomitant/prohibited medication section of the protocol manually and ' +
      'verify medication-history cross-checks at the site.',
    );
  }

  // --- 3. visit_window_verification (facts; empty when nothing extracted) ---
  if (visitItems.length > 0) {
    pushFraming(
      state, 'visit_window_verification', 'section_intro',
      'Check each visit below against its protocol-defined window. Any ' +
      'out-of-window visit requires a documented deviation.',
    );
    for (const { item, visit } of visitItems) {
      const dayText =
        visit.study_day !== null ? `study day ${visit.study_day}` : 'its scheduled study day';
      const windowText =
        visit.window_minus_days === 0 && visit.window_plus_days === 0
          ? 'no window — exact day'
          : `window −${visit.window_minus_days}/+${visit.window_plus_days} days`;
      pushFact(
        state, 'visit_window_verification', item,
        `Verify ${visit.visit_name} occurred on ${dayText} (${windowText}) and ` +
        'that any out-of-window visits are documented with a deviation.',
      );
    }
  }

  // --- 4. endpoint_critical_checks (facts; empty when nothing extracted) ----
  if (endpointItems.length > 0) {
    pushFraming(
      state, 'endpoint_critical_checks', 'section_intro',
      'Endpoint data drives the study conclusions. Verify source data ' +
      'completeness for each endpoint-critical item below.',
    );
    for (const { item, text } of endpointItems) {
      const prefix = item.field_path.startsWith('primary_endpoints')
        ? 'PRIMARY ENDPOINT — '
        : 'Secondary endpoint — ';
      pushFact(
        state, 'endpoint_critical_checks', item,
        `${prefix}verify source data completeness for: ${text}`,
      );
    }
  }

  // --- 5. arm_cohort_randomization_deps (framing; only when cohorts exist) --
  // Cohorts come from protocol_cohorts, a separate table with no passthrough
  // evidence row in this input — so cohort blocks are framing, not facts.
  if (cohorts.length > 0) {
    pushFraming(
      state, 'arm_cohort_randomization_deps', 'section_intro',
      'This protocol defines multiple cohorts/arms. Verify assignment and ' +
      'dosing dependencies for each cohort below.',
    );
    for (const { cohort, label } of cohorts) {
      const dose = asTrimmedString(cohort.dose_regimen) ?? 'dose per protocol';
      const description = asTrimmedString(cohort.description);
      pushFraming(
        state, 'arm_cohort_randomization_deps', 'checklist_item',
        `Cohort ${label}: ${dose} — verify participants are assigned per ` +
        'protocol and dosing matches the cohort.' +
        (description !== null ? ` Description: ${description}` : ''),
      );
    }
    pushFraming(
      state, 'arm_cohort_randomization_deps', 'checklist_item',
      'Randomization mechanics are not extracted by PIQC — verify assignment ' +
      "procedures against the protocol's randomization section.",
    );
  }

  // --- 6. safety_specimen_imaging_vendor_checks (heuristic facts, forced low) --
  // One block per matched visit-procedure pair; identical procedure strings
  // across visits are deduped — the first visit wins and is named in the text.
  let safetyFactCount = 0;
  const seenProcedures = new Set<string>();
  for (const { item, visit } of visitItems) {
    for (const procedure of visit.procedures) {
      const category = categorizeProcedure(procedure);
      if (category === null) continue;
      const dedupeKey = procedure.toLowerCase();
      if (seenProcedures.has(dedupeKey)) continue;
      seenProcedures.add(dedupeKey);
      pushFact(
        state, 'safety_specimen_imaging_vendor_checks', item,
        `Confirm handling/documentation for '${procedure}' (${visit.visit_name}) ` +
        `— ${category} workflow.`,
        'low', // heuristic match — confidence is forced low regardless of the visit item's own state
      );
      safetyFactCount++;
    }
  }
  if (safetyFactCount === 0) {
    pushFraming(
      state, 'safety_specimen_imaging_vendor_checks', 'checklist_item',
      'No laboratory, imaging, or vendor-dependent procedures were detected in ' +
      "the extracted visit schedule. Review the protocol's laboratory manual, " +
      'imaging charter, and vendor plans manually to verify these workflows at the site.',
    );
  }

  // --- 7. source_doc_focus (framing only) -----------------------------------
  pushFraming(
    state, 'source_doc_focus', 'section_intro',
    'Focus source-document verification on the highest-risk data areas ' +
    'identified for this protocol. Source records must support every CRF entry.',
  );
  if (endpointItems.some(({ item }) => item.field_path.startsWith('primary_endpoints'))) {
    pushFraming(
      state, 'source_doc_focus', 'checklist_item',
      'Prioritize source verification for primary-endpoint data points.',
    );
  }
  if (safetyFactCount > 0) {
    pushFraming(
      state, 'source_doc_focus', 'checklist_item',
      'Confirm safety assessments are documented in source, not only in the CRF.',
    );
  }

  // --- 8. amendment_sensitive (fact when an amendment was extracted) --------
  if (amendmentEntry !== null) {
    pushFraming(
      state, 'amendment_sensitive', 'section_intro',
      'This protocol has amendment activity. Requirements may have changed ' +
      'between versions — confirm the site operates from the current version.',
    );
    pushFact(
      state, 'amendment_sensitive', amendmentEntry.item,
      `Amendment noted: ${amendmentEntry.text}. Verify affected requirements ` +
      'below are executed per the CURRENT version.',
    );
  } else {
    pushFraming(
      state, 'amendment_sensitive', 'checklist_item',
      'No amendment was detected in this protocol version. Confirm with the ' +
      'sponsor that you hold the current version.',
    );
  }

  // --- 9. site_questions (templated framing, always) ------------------------
  pushFraming(
    state, 'site_questions', 'site_question',
    'Have there been any staffing changes since the last monitoring visit? If ' +
    'so, confirm delegation-of-authority updates and training documentation for new staff.',
  );
  pushFraming(
    state, 'site_questions', 'site_question',
    'How is investigator oversight documented between monitoring visits? Ask ' +
    "to see where the investigator's review of safety data and eligibility decisions is recorded.",
  );
  pushFraming(
    state, 'site_questions', 'site_question',
    'How does enrollment compare with the screening-failure rate? Discuss any ' +
    'pattern that could indicate eligibility pressure or recruitment difficulties.',
  );

  return state.blocks;
}
