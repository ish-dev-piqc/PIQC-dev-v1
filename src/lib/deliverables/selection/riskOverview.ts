// =============================================================================
// Protocol Deliverable Engine — Sponsor Risk Overview selection.
//
// Pure deterministic ruleset: takes already-extracted protocol facts (SOTR's
// protocol_extracted_items joined to their primary evidence) and produces the
// ordered RiskBlockSpec[] for a risk_overview artifact. No I/O, no side
// effects, never throws. Same fact pool, same input contract, and same
// two-emitter discipline as selection/monitoringChecklist.ts — a second lens
// over the one extraction layer, never a second pipeline.
//
// This module is the unit-tested SPEC for the risk_overview branch of the
// deliverable_generate RPC — the SQL port implements exactly these rules.
// Change rules here first, keep the tests green, then mirror in the migration.
//
// Doctrine (handover §6.1-A + plan Decision 2): explainable complexity
// factors ONLY. Every card names WHY it merits attention in prose and links
// to evidence. There are NO numeric risk scores anywhere — not in text, not
// in metadata. The tests enforce this with a no-score pattern over all prose.
//
// Content-origin discipline (the 3-way taxonomy — never blurred):
// - protocol_fact blocks ALWAYS carry extracted_item_id + evidence
//   passthrough + a confidence_state (missing item confidence degrades to
//   'needs_review', never to a silent null).
// - derived_operational_framing blocks NEVER carry evidence or confidence —
//   framing must not claim false provenance.
// - human_editorial is never emitted here; humans add those blocks later.
//
// Section emission policy (order = RISK_SECTION_ORDER):
// - eligibility_complexity emits when a criterion is flagged OR a restricted
//   medication was extracted (prohibited_med facts — the risk-lens debt named
//   in the prohibited-meds plan, settled here); silent only when neither.
// - visit_window_pressure, endpoint_critical_procedures, and
//   coordination_burden emit nothing when no facts are flagged (empty
//   sections are hidden by groupBlocksBySection downstream).
// - vendor_lab_imaging_dependencies and amendment_sensitivity always say
//   something: explicit fallback framing instead of silence.
//
// Thresholds are v1 heuristics (plan Decision 6) — deliberately conservative;
// tune with founder feedback.
//
// Sensitive: quoted_text flows through as source_quote — never log it.
// =============================================================================

import type {
  RiskOverviewSectionKey,
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
 * NewBlockSpec pins it to MonitoringChecklistSectionKey, so the risk
 * vocabulary needs its own spec type (monitoringChecklist.ts is frozen for
 * this feature; widening there was deliberately not done).
 */
export type RiskBlockSpec = Omit<NewBlockSpec, 'section_key'> & {
  section_key: RiskOverviewSectionKey;
};

// -----------------------------------------------------------------------------
// v1 heuristic thresholds (plan Decision 6). The intro prose restates these
// numbers in words — keep both in sync when tuning.
// -----------------------------------------------------------------------------

/** A criterion strictly longer than this flags as 'lengthy criterion'. */
const LONG_CRITERION_CHARS = 220;
/** A visit with window_minus_days + window_plus_days <= this flags. */
const NARROW_WINDOW_TOTAL_DAYS = 2;
/** A visit with at least this many procedures flags as dense. */
const DENSE_VISIT_PROCEDURES = 8;

/**
 * Conditional language that makes an eligibility criterion operationally
 * complex. Word-boundary + case-insensitive; no 'g' flag so .test() carries
 * no lastIndex state between calls.
 */
const CONDITIONAL_LANGUAGE = /\b(?:if|unless|except|prior|history of|within)\b/i;

// -----------------------------------------------------------------------------
// Defensive value readers — extracted_value comes from a jsonb column; treat
// every shape as hostile. Bad values skip the item, never throw.
// KEEP IN SYNC with selection/monitoringChecklist.ts — its readers are
// module-private and that file is frozen for this feature, so they are
// duplicated here rather than exported from it.
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

/** Normalizes a 'visit' extracted_value. Returns null (skip) when the value
 *  is not an object or has no usable visit_name — a nameless visit cannot
 *  produce meaningful risk prose. Windows default to 0; a non-array
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
// vendor_lab_imaging_dependencies heuristic — the checklist's EXACT keyword
// taxonomy and priority over visit procedures. Vendor is checked FIRST: its
// keywords are the most specific ('central lab' would otherwise be shadowed
// by the specimen 'lab' keyword), then imaging, then specimen. Word-boundary
// patterns avoid false hits like the 'lab' in 'available'. Input is
// lowercased before matching.
// KEEP IN SYNC with selection/monitoringChecklist.ts section 6.
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
  blocks: RiskBlockSpec[];
  nextSortOrder: number;
}

function pushFraming(
  state: EmitState,
  sectionKey: RiskOverviewSectionKey,
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
  sectionKey: RiskOverviewSectionKey,
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
 * Selects the draft Sponsor Risk Overview blocks from extracted protocol
 * facts. Pure function — no I/O, deterministic, never throws. Emission order
 * follows RISK_SECTION_ORDER; sort_order is a single globally increasing
 * sequence (0-based) over the emitted blocks. Cohorts in the input are
 * deliberately not consumed — no risk section reads them.
 */
export function selectRiskOverviewBlocks(input: SelectionInput): RiskBlockSpec[] {
  const state: EmitState = { blocks: [], nextSortOrder: 0 };

  // Pre-scan the item pools each section selects from (input order preserved).
  const criterionItems = input.items
    .map((item) => ({
      item,
      text:
        item.field_type === 'inclusion_criterion' || item.field_type === 'exclusion_criterion'
          ? asTrimmedString(item.extracted_value)
          : null,
    }))
    .filter((e): e is { item: SelectionSourceItem; text: string } => e.text !== null);

  const prohibitedMedItems = input.items
    .map((item) => ({ item, text: item.field_type === 'prohibited_med' ? asTrimmedString(item.extracted_value) : null }))
    .filter((e): e is { item: SelectionSourceItem; text: string } => e.text !== null);

  const visitItems = input.items
    .map((item) => ({ item, visit: item.field_type === 'visit' ? readVisitValue(item.extracted_value) : null }))
    .filter((e): e is { item: SelectionSourceItem; visit: VisitValue } => e.visit !== null);

  const primaryEndpointItems = input.items
    .map((item) => ({
      item,
      text:
        item.field_type === 'endpoint' && item.field_path.startsWith('primary_endpoints')
          ? asTrimmedString(item.extracted_value)
          : null,
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

  // --- 1. eligibility_complexity (facts; absent only when nothing is flagged
  //     AND no restricted medication was extracted) --------------------------
  // A criterion flags for conditional language OR excessive length; when both
  // apply, conditional logic wins as the named reason (deterministic).
  // Restricted medications (prohibited_med facts) always emit — every one is
  // a medication-history screen the site can miss, so there is no flagging
  // heuristic to apply. Med cards follow the flagged-criteria cards. Prose is
  // this lens's own (fragility register) — never the checklist's imperative
  // "Confirm absence of ..." wording for the same facts.
  const flaggedCriteria: Array<{
    item: SelectionSourceItem;
    text: string;
    reason: 'conditional logic' | 'lengthy criterion';
  }> = [];
  for (const { item, text } of criterionItems) {
    if (CONDITIONAL_LANGUAGE.test(text)) {
      flaggedCriteria.push({ item, text, reason: 'conditional logic' });
    } else if (text.length > LONG_CRITERION_CHARS) {
      flaggedCriteria.push({ item, text, reason: 'lengthy criterion' });
    }
  }
  if (flaggedCriteria.length > 0 || prohibitedMedItems.length > 0) {
    const medCount = prohibitedMedItems.length;
    const medNoun = medCount === 1 ? 'medication' : 'medications';
    if (flaggedCriteria.length > 0 && medCount > 0) {
      pushFraming(
        state, 'eligibility_complexity', 'section_intro',
        `PIQC flagged ${flaggedCriteria.length} of ${criterionItems.length} eligibility criteria as ` +
        'complex — conditional logic or lengthy definitions make screening errors and eligibility ' +
        `deviations more likely. The protocol also restricts ${medCount} ${medNoun} within ` +
        'eligibility scope, widening the screening surface with medication-history checks. Review ' +
        'how the site will operationalize each flagged criterion and each restriction.',
      );
    } else if (flaggedCriteria.length > 0) {
      // No restricted medications extracted — byte-identical legacy intro.
      pushFraming(
        state, 'eligibility_complexity', 'section_intro',
        `PIQC flagged ${flaggedCriteria.length} of ${criterionItems.length} eligibility criteria as ` +
        'complex — conditional logic or lengthy definitions make screening errors and eligibility ' +
        'deviations more likely. Review how the site will operationalize each flagged criterion.',
      );
    } else {
      pushFraming(
        state, 'eligibility_complexity', 'section_intro',
        `This protocol restricts ${medCount} ${medNoun} within eligibility scope. Each restricted ` +
        'medication widens the screening surface, and a missed medication-history match surfaces ' +
        'late as an eligibility deviation. Review how the site will operationalize each restriction.',
      );
    }
    for (const { item, text, reason } of flaggedCriteria) {
      pushFact(state, 'eligibility_complexity', item, `Complex eligibility — ${reason}: ${text}`);
    }
    for (const { item, text } of prohibitedMedItems) {
      pushFact(state, 'eligibility_complexity', item, `Restricted medication in eligibility scope: ${text}`);
    }
  }

  // --- 2. visit_window_pressure (facts; absent when no visit qualifies) -----
  const narrowVisits = visitItems.filter(
    ({ visit }) => visit.window_minus_days + visit.window_plus_days <= NARROW_WINDOW_TOTAL_DAYS,
  );
  if (narrowVisits.length > 0) {
    pushFraming(
      state, 'visit_window_pressure', 'section_intro',
      `PIQC identified ${narrowVisits.length} of ${visitItems.length} extracted visits with narrow ` +
      `scheduling tolerance (total window of ${NARROW_WINDOW_TOTAL_DAYS} days or less). Narrow ` +
      'windows leave little room to reschedule, so each of these visits carries a standing ' +
      'deviation risk.',
    );
    for (const { item, visit } of narrowVisits) {
      const dayText =
        visit.study_day !== null ? `study day ${visit.study_day}` : 'its scheduled study day';
      if (visit.window_minus_days === 0 && visit.window_plus_days === 0) {
        pushFact(
          state, 'visit_window_pressure', item,
          `Visit window pressure — ${visit.visit_name} (${dayText}): no window — exact day ` +
          'required. Any scheduling slip immediately becomes a protocol deviation.',
        );
      } else {
        pushFact(
          state, 'visit_window_pressure', item,
          `Visit window pressure — ${visit.visit_name} (${dayText}): window ` +
          `−${visit.window_minus_days}/+${visit.window_plus_days} days. A tolerance this narrow ` +
          'makes scheduling conflicts likely to end in documented deviations.',
        );
      }
    }
  }

  // --- 3. endpoint_critical_procedures (facts; PRIMARY endpoints only) ------
  // Secondary endpoints are deliberately excluded (plan Decision 3 — the
  // cognitive-load north star treats them as noise in a risk lens).
  if (primaryEndpointItems.length > 0) {
    const n = primaryEndpointItems.length;
    pushFraming(
      state, 'endpoint_critical_procedures', 'section_intro',
      `This protocol defines ${n} primary ${n === 1 ? 'endpoint' : 'endpoints'}. Primary-endpoint ` +
      'data drives the study conclusions, so the procedures feeding it warrant the strongest ' +
      'source-data verification emphasis. Secondary endpoints are deliberately excluded from this view.',
    );
    for (const { item, text } of primaryEndpointItems) {
      pushFact(
        state, 'endpoint_critical_procedures', item,
        `Primary endpoint — source-data verification emphasis: ${text}`,
      );
    }
  }

  // --- 4. vendor_lab_imaging_dependencies (heuristic facts, forced low) -----
  // One card per matched visit-procedure pair; identical procedure strings
  // across visits are deduped — the first visit wins and is named in the text.
  const dependencyMatches: Array<{
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
      dependencyMatches.push({ item, visit, procedure, category });
    }
  }
  if (dependencyMatches.length > 0) {
    const n = dependencyMatches.length;
    pushFraming(
      state, 'vendor_lab_imaging_dependencies', 'section_intro',
      `PIQC detected ${n} procedure ${n === 1 ? 'dependency' : 'dependencies'} on external ` +
      'vendors, laboratories, or imaging workflows (keyword-based detection, so confidence is ' +
      "marked low). Each dependency adds turnaround time and coordination outside the site's " +
      'direct control.',
    );
    for (const { item, visit, procedure, category } of dependencyMatches) {
      pushFact(
        state, 'vendor_lab_imaging_dependencies', item,
        `External dependency — '${procedure}' (${visit.visit_name}): ${category} workflow ` +
        "depends on coordination and turnaround outside the site's direct control.",
        'low', // heuristic match — confidence is forced low regardless of the visit item's own state
      );
    }
  } else {
    pushFraming(
      state, 'vendor_lab_imaging_dependencies', 'checklist_item',
      'No laboratory, imaging, or vendor-dependent procedures were detected in the extracted ' +
      "visit schedule. Review the protocol's laboratory manual, imaging charter, and vendor " +
      'plans to confirm whether external dependencies exist.',
    );
  }

  // --- 5. coordination_burden (facts; absent when no visit is dense) --------
  const denseVisits = visitItems.filter(
    ({ visit }) => visit.procedures.length >= DENSE_VISIT_PROCEDURES,
  );
  if (denseVisits.length > 0) {
    pushFraming(
      state, 'coordination_burden', 'section_intro',
      `PIQC flagged ${denseVisits.length} ${denseVisits.length === 1 ? 'visit' : 'visits'} with a ` +
      `dense procedure load (${DENSE_VISIT_PROCEDURES} or more procedures). Dense visits ` +
      'concentrate multiple roles and handoffs into a single day, raising the chance of missed ' +
      'or out-of-sequence assessments.',
    );
    for (const { item, visit } of denseVisits) {
      pushFact(
        state, 'coordination_burden', item,
        `Dense visit — ${visit.visit_name}: ${visit.procedures.length} procedures scheduled; ` +
        'multi-role coordination pressure.',
      );
    }
  }

  // --- 6. amendment_sensitivity (fact when an amendment was extracted) ------
  if (amendmentEntry !== null) {
    pushFraming(
      state, 'amendment_sensitivity', 'section_intro',
      'This protocol has amendment activity. Amended requirements are a common source of version ' +
      'confusion at sites — the areas the amendment touches deserve elevated monitoring emphasis.',
    );
    pushFact(
      state, 'amendment_sensitivity', amendmentEntry.item,
      `Amendment in force: ${amendmentEntry.text} — affected requirements deserve monitoring emphasis.`,
    );
  } else {
    pushFraming(
      state, 'amendment_sensitivity', 'checklist_item',
      'No amendment was detected in this protocol version. Confirm with the sponsor that the ' +
      'site holds and operates from the current protocol version.',
    );
  }

  return state.blocks;
}
