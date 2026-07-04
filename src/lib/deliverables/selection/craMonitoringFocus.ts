// =============================================================================
// Protocol Deliverable Engine — CRA Monitoring Focus selection.
//
// Pure deterministic ruleset: takes already-extracted protocol facts (SOTR's
// protocol_extracted_items joined to their primary evidence) and produces the
// ordered CraFocusBlockSpec[] for a cra_monitoring_focus artifact. No I/O, no
// side effects, never throws. Same fact pool, same input contract, and same
// two-emitter discipline as selection/monitoringChecklist.ts — a THIRD lens
// over the one extraction layer, never a second pipeline.
//
// This module is the unit-tested SPEC for the cra_monitoring_focus branch of
// the deliverable_generate RPC — the SQL port implements exactly these rules.
// Change rules here first, keep the tests green, then mirror in the migration.
//
// Doctrine (handover §6.1-D + plan Decision 3): ATTENTION ALLOCATION. The
// checklist answers "what must be verified" (imperative task cards), the risk
// overview answers "where is execution fragile" (fragility factors) — this
// lens answers "where should a monitor's limited on-site time go FIRST".
// Same facts, different question: card prose here ("Prioritize verification
// of …", "Plan on-site time for …") NEVER duplicates the checklist's
// "Verify:" / "Confirm absence of" templates or the risk lens's "Complex
// eligibility —" / "Visit window pressure —" templates. The tests enforce
// this with distinctive-prefix assertions.
//
// There are NO numeric risk scores anywhere — not in text, not in metadata.
// The tests enforce this with a no-score pattern over all prose.
//
// Protocol-only (plan Decision 2): no site or participant context in any
// prose — protocol-only data must not pretend to know what happened at a
// site. Context overlays are a later phase.
//
// Content-origin discipline (the 3-way taxonomy — never blurred):
// - protocol_fact blocks ALWAYS carry extracted_item_id + evidence
//   passthrough + a confidence_state (missing item confidence degrades to
//   'needs_review', never to a silent null).
// - derived_operational_framing blocks NEVER carry evidence or confidence —
//   framing must not claim false provenance.
// - human_editorial is never emitted here; humans add those blocks later.
//
// Section emission policy (order = CRA_FOCUS_SECTION_ORDER):
// - eligibility_verification_emphasis, fragile_visit_windows, and
//   endpoint_critical_verification emit nothing when no facts qualify (empty
//   sections are hidden by groupBlocksBySection downstream).
// - vendor_specimen_workflows and amendment_sensitive_requirements always
//   say something: explicit fallback framing instead of silence.
//
// First consumer of the prohibited_med facts from the #412 extraction slice:
// every prohibited_med becomes a medication-history-review priority card in
// the eligibility-emphasis section.
//
// Sensitive: quoted_text flows through as source_quote — never log it.
// =============================================================================

import type {
  CraFocusSectionKey,
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
 * NewBlockSpec pins it to MonitoringChecklistSectionKey, so the CRA-focus
 * vocabulary needs its own spec type (monitoringChecklist.ts is frozen for
 * this feature; widening there was deliberately not done — same call as
 * RiskBlockSpec in selection/riskOverview.ts).
 */
export type CraFocusBlockSpec = Omit<NewBlockSpec, 'section_key'> & {
  section_key: CraFocusSectionKey;
};

// -----------------------------------------------------------------------------
// v1 heuristic thresholds. The intro prose restates these numbers in words —
// keep both in sync when tuning.
// KEEP IN SYNC with selection/riskOverview.ts — the complexity and window
// thresholds are the SAME heuristics viewed through a different lens; a
// criterion the risk lens calls complex is exactly the one a monitor should
// verify first. Tune them together or the lenses contradict each other.
// -----------------------------------------------------------------------------

/** A criterion strictly longer than this flags as 'lengthy criterion'. */
const LONG_CRITERION_CHARS = 220;
/** A visit with window_minus_days + window_plus_days <= this flags as fragile. */
const FRAGILE_WINDOW_TOTAL_DAYS = 2;

/**
 * Conditional language that makes an eligibility criterion operationally
 * complex. Word-boundary + case-insensitive; no 'g' flag so .test() carries
 * no lastIndex state between calls.
 * KEEP IN SYNC with selection/riskOverview.ts.
 */
const CONDITIONAL_LANGUAGE = /\b(?:if|unless|except|prior|history of|within)\b/i;

// -----------------------------------------------------------------------------
// Defensive value readers — extracted_value comes from a jsonb column; treat
// every shape as hostile. Bad values skip the item, never throw.
// KEEP IN SYNC with selection/monitoringChecklist.ts and
// selection/riskOverview.ts — their readers are module-private and both files
// are frozen for this feature, so they are duplicated here rather than
// exported from either.
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
 *  produce meaningful focus prose. Windows default to 0; a non-array
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
// vendor_specimen_workflows heuristic — the checklist's EXACT keyword taxonomy
// and priority over visit procedures. Vendor is checked FIRST: its keywords
// are the most specific ('central lab' would otherwise be shadowed by the
// specimen 'lab' keyword), then imaging, then specimen. Word-boundary patterns
// avoid false hits like the 'lab' in 'available'. Input is lowercased before
// matching.
// KEEP IN SYNC with selection/monitoringChecklist.ts section 6 and
// selection/riskOverview.ts section 4.
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
  blocks: CraFocusBlockSpec[];
  nextSortOrder: number;
}

function pushFraming(
  state: EmitState,
  sectionKey: CraFocusSectionKey,
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
  sectionKey: CraFocusSectionKey,
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
 * Selects the draft CRA Monitoring Focus blocks from extracted protocol
 * facts. Pure function — no I/O, deterministic, never throws. Emission order
 * follows CRA_FOCUS_SECTION_ORDER; sort_order is a single globally increasing
 * sequence (0-based) over the emitted blocks. Cohorts in the input are
 * deliberately not consumed — no focus section reads them.
 */
export function selectCraMonitoringFocusBlocks(input: SelectionInput): CraFocusBlockSpec[] {
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
    .map((item) => ({
      item,
      text: item.field_type === 'prohibited_med' ? asTrimmedString(item.extracted_value) : null,
    }))
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

  // --- 1. eligibility_verification_emphasis (facts; absent when nothing
  //     qualifies) --------------------------------------------------------------
  // Two feeds: (a) complex criteria — flagged for conditional language OR
  // excessive length; when both apply, conditional logic wins as the named
  // reason (deterministic, same priority as the risk lens); (b) EVERY
  // prohibited_med fact — restricted medications are where medication-history
  // review time pays off first.
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
    const emphasisParts: string[] = [];
    if (flaggedCriteria.length > 0) {
      emphasisParts.push(
        `${flaggedCriteria.length} complex eligibility ` +
        `${flaggedCriteria.length === 1 ? 'criterion' : 'criteria'}`,
      );
    }
    if (prohibitedMedItems.length > 0) {
      emphasisParts.push(
        `${prohibitedMedItems.length} protocol-restricted ` +
        `${prohibitedMedItems.length === 1 ? 'medication' : 'medications'}`,
      );
    }
    pushFraming(
      state, 'eligibility_verification_emphasis', 'section_intro',
      `PIQC identified ${emphasisParts.join(' and ')} that warrant focused on-site attention. ` +
      'Prioritize verification of these before routine eligibility review — they are where ' +
      'screening errors concentrate.',
    );
    for (const { item, text, reason } of flaggedCriteria) {
      pushFact(
        state, 'eligibility_verification_emphasis', item,
        `Prioritize eligibility verification — ${reason}: ${text}`,
      );
    }
    for (const { item, text } of prohibitedMedItems) {
      pushFact(
        state, 'eligibility_verification_emphasis', item,
        `Prioritize medication-history review: ${text} is restricted by the protocol.`,
      );
    }
  }

  // --- 2. fragile_visit_windows (facts; absent when no visit qualifies) -----
  const fragileVisits = visitItems.filter(
    ({ visit }) => visit.window_minus_days + visit.window_plus_days <= FRAGILE_WINDOW_TOTAL_DAYS,
  );
  if (fragileVisits.length > 0) {
    pushFraming(
      state, 'fragile_visit_windows', 'section_intro',
      `PIQC identified ${fragileVisits.length} ${fragileVisits.length === 1 ? 'visit' : 'visits'} ` +
      `with a fragile scheduling window (total tolerance of ${FRAGILE_WINDOW_TOTAL_DAYS} days or ` +
      'less). Plan on-site time to verify the actual visit dates for each against source ' +
      'scheduling records.',
    );
    for (const { item, visit } of fragileVisits) {
      const dayText =
        visit.study_day !== null ? `study day ${visit.study_day}` : 'its scheduled study day';
      if (visit.window_minus_days === 0 && visit.window_plus_days === 0) {
        pushFact(
          state, 'fragile_visit_windows', item,
          `Plan on-site window verification — ${visit.visit_name} (${dayText}): the protocol ` +
          'allows no scheduling window — confirm the exact visit date against source records.',
        );
      } else {
        pushFact(
          state, 'fragile_visit_windows', item,
          `Plan on-site window verification — ${visit.visit_name} (${dayText}): window ` +
          `−${visit.window_minus_days}/+${visit.window_plus_days} days — confirm each occurrence ` +
          'fell inside this tolerance.',
        );
      }
    }
  }

  // --- 3. endpoint_critical_verification (facts; PRIMARY endpoints only) ----
  // Secondary endpoints are deliberately excluded — in an attention-allocation
  // lens they are noise (same call as the risk lens; cognitive-load north star).
  if (primaryEndpointItems.length > 0) {
    const n = primaryEndpointItems.length;
    pushFraming(
      state, 'endpoint_critical_verification', 'section_intro',
      'Allocate the strongest share of source-data verification time to primary-endpoint data — ' +
      `it carries the study conclusions. This protocol defines ${n} primary ` +
      `${n === 1 ? 'endpoint' : 'endpoints'}; secondary endpoints are deliberately excluded ` +
      'from this focus view.',
    );
    for (const { item, text } of primaryEndpointItems) {
      pushFact(
        state, 'endpoint_critical_verification', item,
        `Prioritize source-data verification for the primary endpoint: ${text}`,
      );
    }
  }

  // --- 4. vendor_specimen_workflows (heuristic facts, forced low; always
  //     says something) ---------------------------------------------------------
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
      state, 'vendor_specimen_workflows', 'section_intro',
      `PIQC detected ${n} external-workflow ${n === 1 ? 'dependency' : 'dependencies'} across ` +
      'the extracted visits (keyword-based detection, so confidence is marked low). Plan ' +
      'on-site time to confirm each directly — turnaround and coordination sit outside the ' +
      "site's control.",
    );
    for (const { item, visit, procedure, category } of workflowMatches) {
      pushFact(
        state, 'vendor_specimen_workflows', item,
        `Confirm on-site: '${procedure}' (${visit.visit_name}) — ${category} workflow warrants ` +
        'direct verification.',
        'low', // heuristic match — confidence is forced low regardless of the visit item's own state
      );
    }
  } else {
    pushFraming(
      state, 'vendor_specimen_workflows', 'checklist_item',
      'PIQC detected no laboratory, imaging, or vendor-dependent procedures in the extracted ' +
      "visit schedule. Before the visit, check the protocol's laboratory manual, imaging " +
      'charter, and vendor plans to decide whether any external workflow still needs direct ' +
      'on-site verification.',
    );
  }

  // --- 5. amendment_sensitive_requirements (always says something) ----------
  if (amendmentEntry !== null) {
    pushFraming(
      state, 'amendment_sensitive_requirements', 'section_intro',
      'This protocol has amendment activity. Version confusion concentrates deviations exactly ' +
      'where requirements changed — allocate review time to the amendment-affected areas first.',
    );
    pushFact(
      state, 'amendment_sensitive_requirements', amendmentEntry.item,
      `Amendment-affected: ${amendmentEntry.text} — re-verify impacted requirements against ` +
      'the current version.',
    );
  } else {
    pushFraming(
      state, 'amendment_sensitive_requirements', 'checklist_item',
      'PIQC detected no amendment in this protocol version. Confirm on-site that the site ' +
      "operates from the sponsor's current version before allocating further review time.",
    );
  }

  return state.blocks;
}
