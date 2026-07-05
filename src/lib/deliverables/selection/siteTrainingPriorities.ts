// =============================================================================
// Protocol Deliverable Engine — Site Training Priorities selection.
//
// Pure deterministic ruleset: takes already-extracted protocol facts (SOTR's
// protocol_extracted_items joined to their primary evidence) and produces the
// ordered SiteTrainingBlockSpec[] for a site_training_priorities artifact. No
// I/O, no side effects, never throws. Same fact pool, same input contract, and
// same two-emitter discipline as the other four selection specs — a FIFTH lens
// over the one extraction layer, never a second pipeline.
//
// This module is the unit-tested SPEC for the site_training_priorities branch
// of the deliverable_generate RPC — the SQL port implements exactly these
// rules. Change rules here first, keep the tests green, then mirror in the
// migration.
//
// Doctrine (handover §6.1): SITE READINESS. The checklist answers "what must be
// verified", the risk overview "where is execution fragile", CRA focus "where
// should a monitor's limited time go" — this lens answers "what must the SITE
// be trained on before activation". Same facts, different question and a
// different REGISTER: an instructional voice ("Train the screening team to …",
// "Brief coordinators on …", "Retrain affected staff …") that NEVER reuses the
// checklist's "Verify:" / "Confirm absence of" wording, the risk lens's
// "PIQC flagged" / "Complex eligibility —" wording, or the CRA lens's
// "Prioritize verification of …". The tests enforce this with distinctive
// training-verb prefixes.
//
// There are NO numeric readiness scores anywhere — not in text, not in
// metadata. The tests enforce this with a no-score pattern over all prose.
//
// COMPLETENESS DOCTRINE (differs from the risk/CRA lenses on purpose): a
// training package that silently omitted a training domain because extraction
// missed the facts would read as "nothing to train" — dangerous for a
// site-readiness artifact. So the four fact-driven domains (eligibility,
// visit schedule, procedures, endpoints) ALWAYS say something: facts when the
// protocol supports them, an explicit "train from the protocol manually" gap
// block when it does not. Safety training and the logistics questions are
// universal obligations and always emit as framing.
//
// Content-origin discipline (the 3-way taxonomy — never blurred):
// - protocol_fact blocks ALWAYS carry extracted_item_id + evidence passthrough
//   + a confidence_state (missing item confidence degrades to 'needs_review').
// - derived_operational_framing blocks NEVER carry evidence or confidence.
// - human_editorial is never emitted here; humans add those blocks later.
//
// Sensitive: quoted_text flows through as source_quote — never log it.
// =============================================================================

import type {
  SiteTrainingSectionKey,
  DeliverableBlockType,
  DeliverableConfidenceState,
} from '../../../types/deliverables';
import type {
  SelectionInput,
  SelectionSourceItem,
  NewBlockSpec,
} from './monitoringChecklist';

/**
 * A block ready for insertion into protocol_deliverable_blocks. Mirrors the
 * checklist's NewBlockSpec field-for-field, widened only at section_key —
 * NewBlockSpec pins it to MonitoringChecklistSectionKey, so the site-training
 * vocabulary needs its own spec type (monitoringChecklist.ts is frozen; the
 * same call as CraFocusBlockSpec / RiskBlockSpec).
 */
export type SiteTrainingBlockSpec = Omit<NewBlockSpec, 'section_key'> & {
  section_key: SiteTrainingSectionKey;
};

// -----------------------------------------------------------------------------
// v1 heuristic threshold. Narrow visit windows get a training-emphasis note.
// KEEP IN SYNC with selection/riskOverview.ts and selection/craMonitoringFocus.ts
// — the window-fragility threshold is the SAME heuristic; a window a monitor
// calls fragile is exactly one coordinators must rehearse booking for.
// -----------------------------------------------------------------------------

/** A visit with window_minus_days + window_plus_days <= this gets the narrow-
 *  window training emphasis. */
const NARROW_WINDOW_TOTAL_DAYS = 2;

// -----------------------------------------------------------------------------
// Defensive value readers — extracted_value comes from a jsonb column; treat
// every shape as hostile. Bad values skip the item, never throw.
// KEEP IN SYNC with selection/monitoringChecklist.ts, selection/riskOverview.ts,
// and selection/craMonitoringFocus.ts — their readers are module-private and
// those files are frozen, so they are duplicated here rather than exported.
// -----------------------------------------------------------------------------

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

/** Normalizes a 'visit' extracted_value. Returns null (skip) when the value is
 *  not an object or has no usable visit_name. Windows default to 0; a non-array
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
// Procedure categorization — the checklist's EXACT keyword taxonomy and
// priority. Vendor is checked FIRST (its keywords are the most specific:
// 'central lab' would otherwise be shadowed by the specimen 'lab' keyword),
// then imaging, then specimen. Word-boundary patterns avoid false hits like the
// 'lab' in 'available'. Input is lowercased before matching.
// KEEP IN SYNC with selection/monitoringChecklist.ts section 6,
// selection/riskOverview.ts section 4, and selection/craMonitoringFocus.ts
// section 4.
// -----------------------------------------------------------------------------

type ProcedureCategory = 'specimen' | 'imaging' | 'vendor';

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
  blocks: SiteTrainingBlockSpec[];
  nextSortOrder: number;
}

function pushFraming(
  state: EmitState,
  sectionKey: SiteTrainingSectionKey,
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
  sectionKey: SiteTrainingSectionKey,
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
 * Selects the draft Site Training Priorities blocks from extracted protocol
 * facts. Pure function — no I/O, deterministic, never throws. Emission order
 * follows SITE_TRAINING_SECTION_ORDER; sort_order is a single globally
 * increasing sequence (0-based) over the emitted blocks. Cohorts in the input
 * are deliberately not consumed — no training section reads them.
 */
export function selectSiteTrainingPrioritiesBlocks(
  input: SelectionInput,
): SiteTrainingBlockSpec[] {
  const state: EmitState = { blocks: [], nextSortOrder: 0 };

  // Pre-scan the item pools each section selects from (input order preserved).
  const inclusionItems = input.items
    .map((item) => ({
      item,
      text: item.field_type === 'inclusion_criterion' ? asTrimmedString(item.extracted_value) : null,
    }))
    .filter((e): e is { item: SelectionSourceItem; text: string } => e.text !== null);

  const exclusionItems = input.items
    .map((item) => ({
      item,
      text: item.field_type === 'exclusion_criterion' ? asTrimmedString(item.extracted_value) : null,
    }))
    .filter((e): e is { item: SelectionSourceItem; text: string } => e.text !== null);

  const prohibitedMedItems = input.items
    .map((item) => ({
      item,
      text: item.field_type === 'prohibited_med' ? asTrimmedString(item.extracted_value) : null,
    }))
    .filter((e): e is { item: SelectionSourceItem; text: string } => e.text !== null);

  const visitItems = input.items
    .map((item) => ({ item, visit: item.field_type === 'visit' ? readVisitValue(item.extracted_value) : null }))
    .filter((e): e is { item: SelectionSourceItem; visit: VisitValue } => e.visit !== null);

  const endpointItems = input.items
    .map((item) => ({
      item,
      text: item.field_type === 'endpoint' ? asTrimmedString(item.extracted_value) : null,
    }))
    .filter((e): e is { item: SelectionSourceItem; text: string } => e.text !== null);

  const amendmentEntry = input.items
    .map((item) => ({
      item,
      text:
        item.field_type === 'metadata' && item.field_path === 'amendment_summary'
          ? asTrimmedString(item.extracted_value)
          : null,
    }))
    .find((e): e is { item: SelectionSourceItem; text: string } => e.text !== null) ?? null;

  // --- 1. eligibility_screening_training (facts; ALWAYS emits — a training
  //     package must address screening) -----------------------------------------
  pushFraming(
    state, 'eligibility_screening_training', 'section_intro',
    "The site's screening team makes every eligibility determination. Before " +
    'first-patient-in, train them on the inclusion requirements, exclusions, and ' +
    'medication restrictions below, and confirm each maps to a source document.',
  );
  for (const { item, text } of inclusionItems) {
    pushFact(
      state, 'eligibility_screening_training', item,
      `Train the screening team to confirm the inclusion requirement: ${text}`,
    );
  }
  for (const { item, text } of exclusionItems) {
    pushFact(
      state, 'eligibility_screening_training', item,
      `Train the screening team to rule out the exclusion: ${text}`,
    );
  }
  for (const { item, text } of prohibitedMedItems) {
    pushFact(
      state, 'eligibility_screening_training', item,
      `Train staff to screen medication history for the restricted medication: ${text}`,
    );
  }
  if (inclusionItems.length + exclusionItems.length + prohibitedMedItems.length === 0) {
    pushFraming(
      state, 'eligibility_screening_training', 'checklist_item',
      'No eligibility criteria were extracted from this protocol. Train the ' +
      "screening team directly from the protocol's eligibility section, and " +
      'confirm the medication-history review process with the site.',
    );
  }

  // --- 2. visit_schedule_training (facts; ALWAYS says something) -------------
  if (visitItems.length > 0) {
    pushFraming(
      state, 'visit_schedule_training', 'section_intro',
      'Coordinators own visit scheduling. Train them on the visit schedule below, ' +
      'with extra rehearsal where the protocol allows little timing flexibility.',
    );
    for (const { item, visit } of visitItems) {
      const dayText =
        visit.study_day !== null ? `study day ${visit.study_day}` : 'its scheduled study day';
      const narrow = visit.window_minus_days + visit.window_plus_days <= NARROW_WINDOW_TOTAL_DAYS;
      const windowText =
        visit.window_minus_days === 0 && visit.window_plus_days === 0
          ? 'no scheduling window — exact day'
          : `window −${visit.window_minus_days}/+${visit.window_plus_days} days`;
      const emphasis = narrow
        ? ' This is a narrow window — a scheduling slip becomes a protocol deviation, so ' +
          'rehearse the booking and reminder process with the coordinators.'
        : '';
      pushFact(
        state, 'visit_schedule_training', item,
        `Brief coordinators on ${visit.visit_name} (${dayText}, ${windowText}).${emphasis}`,
      );
    }
  } else {
    pushFraming(
      state, 'visit_schedule_training', 'checklist_item',
      'No visit schedule was extracted from this protocol. Train coordinators ' +
      "directly from the protocol's schedule of activities.",
    );
  }

  // --- 3. procedure_specimen_training (heuristic facts, forced low; ALWAYS
  //     says something) ----------------------------------------------------------
  // One card per matched visit-procedure pair; identical procedure strings
  // across visits are deduped — the first visit wins and is named in the text.
  const workflowMatches: Array<{
    item: SelectionSourceItem;
    visit: VisitValue;
    procedure: string;
    category: ProcedureCategory;
  }> = [];
  const seenProcedures = new Set<string>();
  for (const { item, visit } of visitItems) {
    for (const procedure of visit.procedures) {
      const category = categorizeProcedure(procedure);
      if (category === null) continue;
      const dedupeKey = procedure.toLowerCase();
      if (seenProcedures.has(dedupeKey)) continue;
      seenProcedures.add(dedupeKey);
      workflowMatches.push({ item, visit, procedure, category });
    }
  }
  if (workflowMatches.length > 0) {
    const n = workflowMatches.length;
    pushFraming(
      state, 'procedure_specimen_training', 'section_intro',
      `The site will execute ${n} vendor, laboratory, imaging, or specimen ` +
      `${n === 1 ? 'workflow' : 'workflows'} below (keyword-based detection, so ` +
      'confidence is marked low). Train the responsible staff on collection, ' +
      'handling, documentation, and vendor coordination for each.',
    );
    for (const { item, visit, procedure, category } of workflowMatches) {
      pushFact(
        state, 'procedure_specimen_training', item,
        `Train site staff on '${procedure}' (${visit.visit_name}) — ${category} ` +
        'workflow: collection/handling, documentation, and vendor coordination.',
        'low', // heuristic match — confidence is forced low regardless of the visit item's own state
      );
    }
  } else {
    pushFraming(
      state, 'procedure_specimen_training', 'checklist_item',
      'PIQC detected no laboratory, imaging, or vendor-dependent procedures in ' +
      "the extracted visit schedule. Check the protocol's laboratory manual, " +
      'imaging charter, and vendor plans, and train staff on any workflow they describe.',
    );
  }

  // --- 4. endpoint_data_training (facts; ALWAYS says something; primary
  //     flagged) -----------------------------------------------------------------
  if (endpointItems.length > 0) {
    pushFraming(
      state, 'endpoint_data_training', 'section_intro',
      "Endpoint data carries the study's conclusions. Train the staff who " +
      'capture it on the source-documentation standard for each endpoint below — ' +
      'primary endpoints warrant the strongest emphasis.',
    );
    for (const { item, text } of endpointItems) {
      const isPrimary = item.field_path.startsWith('primary_endpoints');
      const prose = isPrimary
        ? `PRIMARY ENDPOINT — train staff on source-data capture and documentation for: ${text}`
        : `Secondary endpoint — train staff on source-data capture for: ${text}`;
      pushFact(state, 'endpoint_data_training', item, prose);
    }
  } else {
    pushFraming(
      state, 'endpoint_data_training', 'checklist_item',
      'No endpoints were extracted from this protocol. Train data staff on ' +
      "endpoint capture directly from the protocol's objectives and endpoints section.",
    );
  }

  // --- 5. safety_oversight_training (framing ALWAYS — a universal obligation
  //     the protocol facts do not vary) ------------------------------------------
  pushFraming(
    state, 'safety_oversight_training', 'section_intro',
    'Every site must be trained on safety reporting and investigator oversight, ' +
    'regardless of protocol specifics. Confirm the following are covered in site training.',
  );
  pushFraming(
    state, 'safety_oversight_training', 'checklist_item',
    'Train staff on adverse-event and serious-adverse-event identification, ' +
    "recording, and the protocol's reporting timelines — verify the reporting " +
    'windows against the current protocol.',
  );
  pushFraming(
    state, 'safety_oversight_training', 'checklist_item',
    'Train the site on how investigator oversight is documented between visits, ' +
    'and on delegation-of-authority and training-record expectations for every ' +
    'delegated task.',
  );

  // --- 6. amendment_retraining (fact when an amendment was extracted; else
  //     framing) -----------------------------------------------------------------
  if (amendmentEntry !== null) {
    pushFraming(
      state, 'amendment_retraining', 'section_intro',
      'This protocol has amendment activity. Amended requirements are a leading ' +
      'source of site error — plan retraining wherever the amendment reaches.',
    );
    pushFact(
      state, 'amendment_retraining', amendmentEntry.item,
      `Amendment noted: ${amendmentEntry.text}. Retrain affected site staff on the ` +
      'changed requirements and document the retraining before the changes are implemented.',
    );
  } else {
    pushFraming(
      state, 'amendment_retraining', 'checklist_item',
      'No amendment was detected in this protocol version. When the protocol is ' +
      'amended, retrain affected staff and document the retraining before implementing any change.',
    );
  }

  // --- 7. training_logistics_questions (site_question framing, always) -------
  pushFraming(
    state, 'training_logistics_questions', 'site_question',
    'Is the delegation-of-authority log current, with training documented for ' +
    'every delegated task before it is performed?',
  );
  pushFraming(
    state, 'training_logistics_questions', 'site_question',
    'How will the site onboard and train staff who join after site initiation, ' +
    'and how will their protocol training be documented?',
  );
  pushFraming(
    state, 'training_logistics_questions', 'site_question',
    'Where does the site retain training records, and how will it evidence that ' +
    'each person was trained on the CURRENT protocol version?',
  );

  return state.blocks;
}
