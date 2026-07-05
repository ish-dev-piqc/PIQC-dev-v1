// =============================================================================
// Protocol Deliverable Engine — SIV Knowledge Transfer Package selection.
//
// Pure deterministic ruleset: takes already-extracted protocol facts (SOTR's
// protocol_extracted_items joined to their primary evidence) and produces the
// ordered SivBlockSpec[] for a siv_package artifact. No I/O, no side effects,
// never throws. Same fact pool, same input contract, and same emitter
// discipline as the sibling specs — a FOURTH lens over the one extraction
// layer, never a second pipeline.
//
// This module is the unit-tested SPEC for the siv_package branch of the
// deliverable_generate RPC — the SQL port implements exactly these rules.
// Change rules here first, keep the tests green, then mirror in the migration.
//
// Doctrine (handover §6.4 + plan Decisions): TEACHING. The checklist answers
// "what must be verified", the risk overview "where is execution fragile",
// the CRA focus "where does limited attention go" — this lens answers "what
// must the site UNDERSTAND before the first patient", organized as a
// protocol-specific SIV outline, never a generic table-of-contents deck.
// SIV prose ("The protocol states —", "Emphasize at SIV —", "Timing to
// rehearse —", "Walk through at SIV:") NEVER duplicates the other lenses'
// templates; the tests enforce this with distinctive-prefix assertions.
//
// speaker_note blocks (the block type this slice introduces): every emitted
// section closes with EXACTLY ONE — deterministic teaching prose with the
// structural shape "Teaching point: … Likely site question: … Confirm
// specifics with the sponsor before presenting." The sponsor-confirmation
// sentence is required by the handover and is structural here: the tests
// assert it on every note. Notes are derived_operational_framing — NULL
// evidence, NULL confidence, reviewable/rejectable like any block.
//
// There are NO numeric risk scores anywhere. Protocol-only: no site or
// participant context in any prose. Content-origin discipline as everywhere:
// facts always carry evidence passthrough + confidence (null degrades to
// 'needs_review'); framing never carries either.
//
// Section emission policy (order = SIV_SECTION_ORDER):
// - study_overview, vendor_lab_workflows, safety_expectations,
//   amendment_changes, and before_first_patient ALWAYS emit (fallback
//   framing instead of silence — an SIV deck with holes teaches nothing).
// - participant_journey, eligibility_emphasis, endpoint_critical, and
//   windows_and_timing emit nothing when no facts qualify.
//
// Sensitive: quoted_text flows through as source_quote — never log it.
// =============================================================================

import type {
  SivSectionKey,
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
 * same call as RiskBlockSpec / CraFocusBlockSpec in the sibling specs.
 */
export type SivBlockSpec = Omit<NewBlockSpec, 'section_key'> & {
  section_key: SivSectionKey;
};

// -----------------------------------------------------------------------------
// v1 heuristic thresholds — the SAME numbers as the sibling lenses, viewed
// through the teaching lens: what a monitor verifies first is exactly what a
// site must be taught first.
// KEEP IN SYNC with selection/riskOverview.ts and
// selection/craMonitoringFocus.ts. Tune together or the lenses contradict.
// -----------------------------------------------------------------------------

/** A criterion strictly longer than this flags as 'lengthy criterion'. */
const LONG_CRITERION_CHARS = 220;
/** A visit with window_minus_days + window_plus_days <= this needs rehearsal. */
const NARROW_WINDOW_TOTAL_DAYS = 2;

/**
 * Conditional language that makes an eligibility criterion operationally
 * complex. Word-boundary + case-insensitive; no 'g' flag so .test() carries
 * no lastIndex state between calls.
 * KEEP IN SYNC with selection/riskOverview.ts and
 * selection/craMonitoringFocus.ts.
 */
const CONDITIONAL_LANGUAGE = /\b(?:if|unless|except|prior|history of|within)\b/i;

/** The structural close of every speaker note — the handover's
 *  sponsor-confirmation warning, enforced by tests. */
const SPONSOR_CONFIRM = 'Confirm specifics with the sponsor before presenting.';

// -----------------------------------------------------------------------------
// Defensive value readers — extracted_value comes from a jsonb column; treat
// every shape as hostile. Bad values skip the item, never throw.
// KEEP IN SYNC with selection/monitoringChecklist.ts, selection/riskOverview.ts
// and selection/craMonitoringFocus.ts — module-private in all three frozen
// files, so duplicated here rather than exported from any of them.
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
 *  is not an object or has no usable visit_name. Windows default to 0; a
 *  non-array procedures field degrades to []. */
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
// vendor_lab_workflows heuristic — the checklist's EXACT keyword taxonomy and
// priority (vendor first, then imaging, then specimen) over visit procedures.
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
// Block emitters — the only ways a block is born, so the content-origin and
// one-note-per-section disciplines are structural, not conventional.
// -----------------------------------------------------------------------------

interface EmitState {
  blocks: SivBlockSpec[];
  nextSortOrder: number;
}

function pushFraming(
  state: EmitState,
  sectionKey: SivSectionKey,
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

/** Every emitted section closes through here — exactly one speaker note,
 *  always carrying the sponsor-confirmation sentence. */
function pushSpeakerNote(
  state: EmitState,
  sectionKey: SivSectionKey,
  teachingPoint: string,
  likelyQuestion: string,
): void {
  pushFraming(
    state, sectionKey, 'speaker_note',
    `Teaching point: ${teachingPoint} Likely site question: ${likelyQuestion} ${SPONSOR_CONFIRM}`,
  );
}

function pushFact(
  state: EmitState,
  sectionKey: SivSectionKey,
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
 * Selects the draft SIV Knowledge Transfer Package blocks from extracted
 * protocol facts. Pure function — no I/O, deterministic, never throws.
 * Emission order follows SIV_SECTION_ORDER; sort_order is a single globally
 * increasing sequence (0-based). Cohorts in the input are deliberately not
 * consumed in v1 (cohort teaching joins when the KT layer expands).
 */
export function selectSivPackageBlocks(input: SelectionInput): SivBlockSpec[] {
  const state: EmitState = { blocks: [], nextSortOrder: 0 };

  // Pre-scan the item pools each section selects from (input order preserved).
  const metadataText = (fieldPath: string): { item: SelectionSourceItem; text: string } | null =>
    input.items
      .map((item) => ({
        item,
        text:
          item.field_type === 'metadata' && item.field_path === fieldPath
            ? asTrimmedString(item.extracted_value)
            : null,
      }))
      .find((e): e is { item: SelectionSourceItem; text: string } => e.text !== null) ?? null;

  const studyPhase = metadataText('study_phase');
  const studyDesign = metadataText('study_design');
  const dosingEntry = input.items
    .map((item) => ({
      item,
      text: item.field_type === 'dosing' ? asTrimmedString(item.extracted_value) : null,
    }))
    .find((e): e is { item: SelectionSourceItem; text: string } => e.text !== null) ?? null;

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

  // --- 1. study_overview (ALWAYS emits) --------------------------------------
  pushFraming(
    state, 'study_overview', 'section_intro',
    'Ground the site team in what the study is before any procedure is taught. ' +
    "The bullets below are extracted from the protocol's own words — present them as written.",
  );
  if (studyDesign !== null) {
    pushFact(state, 'study_overview', studyDesign.item,
      `The protocol states — Study design: ${studyDesign.text}`);
  }
  if (studyPhase !== null) {
    pushFact(state, 'study_overview', studyPhase.item,
      `The protocol states — Study phase: ${studyPhase.text}`);
  }
  if (dosingEntry !== null) {
    pushFact(state, 'study_overview', dosingEntry.item,
      `The protocol states — Dosing regimen: ${dosingEntry.text}`);
  }
  pushSpeakerNote(
    state, 'study_overview',
    "Anchor every later slide back to the study's design so procedures have context.",
    'How does this design differ from studies the site has run before?',
  );

  // --- 2. participant_journey (absent when zero usable visits) ---------------
  if (visitItems.length > 0) {
    pushFraming(
      state, 'participant_journey', 'section_intro',
      'Walk the room through the full participant journey, visit by visit — the schedule ' +
      "below is extracted from the protocol's schedule of assessments.",
    );
    for (const { item, visit } of visitItems) {
      const dayText =
        visit.study_day !== null ? `study day ${visit.study_day}` : 'study day per protocol';
      if (visit.window_minus_days === 0 && visit.window_plus_days === 0) {
        pushFact(state, 'participant_journey', item,
          `${visit.visit_name} — ${dayText}, exact day (no window).`);
      } else {
        pushFact(state, 'participant_journey', item,
          `${visit.visit_name} — ${dayText}, window −${visit.window_minus_days}/+${visit.window_plus_days} days.`);
      }
    }
    pushSpeakerNote(
      state, 'participant_journey',
      'Coordinators retain the journey better as a story than a table — narrate one participant start to finish.',
      'Which visits can be scheduled flexibly and which cannot?',
    );
  }

  // --- 3. eligibility_emphasis (absent when nothing qualifies) ---------------
  // Two feeds: complex criteria (conditional language wins over length as the
  // named reason — same deterministic priority as the sibling lenses) and
  // EVERY prohibited_med fact: the SIV must teach medication restrictions.
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
    const parts: string[] = [];
    if (flaggedCriteria.length > 0) {
      parts.push(
        `${flaggedCriteria.length} eligibility ` +
        `${flaggedCriteria.length === 1 ? 'criterion' : 'criteria'} that ` +
        `${flaggedCriteria.length === 1 ? 'needs' : 'need'} unhurried explanation`,
      );
    }
    if (prohibitedMedItems.length > 0) {
      parts.push(
        `${prohibitedMedItems.length} medication ` +
        `${prohibitedMedItems.length === 1 ? 'restriction' : 'restrictions'} the site must teach ` +
        'into its screening routine',
      );
    }
    pushFraming(
      state, 'eligibility_emphasis', 'section_intro',
      `This protocol carries ${parts.join(' and ')}. Spend SIV time here — eligibility ` +
      'misunderstandings set at start-up persist through enrollment.',
    );
    for (const { item, text, reason } of flaggedCriteria) {
      pushFact(state, 'eligibility_emphasis', item,
        `Emphasize at SIV — ${reason}: ${text}`);
    }
    for (const { item, text } of prohibitedMedItems) {
      pushFact(state, 'eligibility_emphasis', item,
        `Medication restriction to teach: ${text}`);
    }
    pushSpeakerNote(
      state, 'eligibility_emphasis',
      'Work an example for each flagged criterion rather than reading it aloud.',
      'Who adjudicates a borderline eligibility call, and how fast?',
    );
  }

  // --- 4. endpoint_critical (PRIMARY endpoints only; absent when none) -------
  if (primaryEndpointItems.length > 0) {
    const n = primaryEndpointItems.length;
    pushFraming(
      state, 'endpoint_critical', 'section_intro',
      `The study's conclusions rest on ${n} primary ${n === 1 ? 'endpoint' : 'endpoints'}. ` +
      'Teach the procedures behind each one as consequential, not routine.',
    );
    for (const { item, text } of primaryEndpointItems) {
      pushFact(state, 'endpoint_critical', item,
        `First-patient quality depends on: ${text}`);
    }
    pushSpeakerNote(
      state, 'endpoint_critical',
      'Tie each primary-endpoint procedure to the data it produces so its handling feels consequential.',
      'What happens operationally when an endpoint assessment is missed?',
    );
  }

  // --- 5. windows_and_timing (absent when no narrow-window visits) -----------
  const narrowVisits = visitItems.filter(
    ({ visit }) => visit.window_minus_days + visit.window_plus_days <= NARROW_WINDOW_TOTAL_DAYS,
  );
  if (narrowVisits.length > 0) {
    pushFraming(
      state, 'windows_and_timing', 'section_intro',
      `${narrowVisits.length} ${narrowVisits.length === 1 ? 'visit allows' : 'visits allow'} ` +
      `${NARROW_WINDOW_TOTAL_DAYS} days or less of scheduling tolerance. Rehearse the scheduling ` +
      'of each at the SIV — timing habits are set on day one.',
    );
    for (const { item, visit } of narrowVisits) {
      const dayText =
        visit.study_day !== null ? `study day ${visit.study_day}` : 'study day per protocol';
      if (visit.window_minus_days === 0 && visit.window_plus_days === 0) {
        pushFact(state, 'windows_and_timing', item,
          `Timing to rehearse — ${visit.visit_name} (${dayText}): exact day — no scheduling window.`);
      } else {
        pushFact(state, 'windows_and_timing', item,
          `Timing to rehearse — ${visit.visit_name} (${dayText}): window ` +
          `−${visit.window_minus_days}/+${visit.window_plus_days} days.`);
      }
    }
    pushSpeakerNote(
      state, 'windows_and_timing',
      'Have the coordinator walk a calendar for the tightest visit rather than presenting the tolerance abstractly.',
      'What is the escalation path when a visit is about to fall out of window?',
    );
  }

  // --- 6. vendor_lab_workflows (ALWAYS says something; heuristic, forced low) -
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
      state, 'vendor_lab_workflows', 'section_intro',
      `${n} external-workflow ${n === 1 ? 'dependency was' : 'dependencies were'} detected in ` +
      'the extracted visits (keyword-based, so confidence is marked low). Each is a hands-on ' +
      'walkthrough at the SIV, not a slide to read.',
    );
    for (const { item, visit, procedure, category } of workflowMatches) {
      pushFact(state, 'vendor_lab_workflows', item,
        `Walk through at SIV: '${procedure}' (${visit.visit_name}) — ${category} workflow.`,
        'low');
    }
  } else {
    pushFraming(
      state, 'vendor_lab_workflows', 'checklist_item',
      'No laboratory, imaging, or vendor-dependent procedures were detected in the extracted ' +
      "visit schedule. Check the protocol's laboratory manual, imaging charter, and vendor " +
      'plans for workflows the SIV should still cover hands-on.',
    );
  }
  pushSpeakerNote(
    state, 'vendor_lab_workflows',
    'Physically trace one specimen or transmission end to end with the people who will do it.',
    'What are the kit expiry and re-supply arrangements?',
  );

  // --- 7. safety_expectations (framing-only; ALWAYS) --------------------------
  // No structured safety extraction exists yet — the honest teaching move is
  // to direct the room to the protocol's own safety sections, never to invent
  // reporting expectations.
  pushFraming(
    state, 'safety_expectations', 'section_intro',
    "Safety and reporting expectations come from the protocol's safety sections and must be " +
    'walked through in their own words at the SIV — reporting definitions, timelines, and ' +
    'responsibilities are protocol-specific and are not paraphrased here.',
  );
  pushSpeakerNote(
    state, 'safety_expectations',
    "Read the reporting timelines directly from the protocol with the team — paraphrase is where safety training goes wrong.",
    'Which events does the sponsor want reported even when in doubt?',
  );

  // --- 8. amendment_changes (ALWAYS says something) ---------------------------
  if (amendmentEntry !== null) {
    pushFraming(
      state, 'amendment_changes', 'section_intro',
      'This protocol carries amendment activity — the SIV must teach the CURRENT version, and ' +
      'name what changed so nobody trains on stale requirements.',
    );
    pushFact(state, 'amendment_changes', amendmentEntry.item,
      `Amendment to present: ${amendmentEntry.text} — walk through every affected requirement.`);
  } else {
    pushFraming(
      state, 'amendment_changes', 'checklist_item',
      'No amendment was detected in this protocol version. State at the SIV which version is ' +
      'being trained and confirm it matches what the sponsor holds current.',
    );
  }
  pushSpeakerNote(
    state, 'amendment_changes',
    'Version confusion concentrates deviations — say the version number out loud and put it on the slide.',
    'How will the site be notified of the next amendment?',
  );

  // --- 9. before_first_patient (framing close; ALWAYS) ------------------------
  const closeParts: string[] = [];
  if (flaggedCriteria.length > 0) {
    closeParts.push(
      `${flaggedCriteria.length} eligibility ${flaggedCriteria.length === 1 ? 'emphasis' : 'emphases'}`,
    );
  }
  if (prohibitedMedItems.length > 0) {
    closeParts.push(
      `${prohibitedMedItems.length} medication ${prohibitedMedItems.length === 1 ? 'restriction' : 'restrictions'}`,
    );
  }
  if (primaryEndpointItems.length > 0) {
    closeParts.push(
      `${primaryEndpointItems.length} endpoint-critical ${primaryEndpointItems.length === 1 ? 'procedure' : 'procedures'}`,
    );
  }
  if (narrowVisits.length > 0) {
    closeParts.push(
      `${narrowVisits.length} timing ${narrowVisits.length === 1 ? 'rehearsal' : 'rehearsals'}`,
    );
  }
  pushFraming(
    state, 'before_first_patient', 'section_intro',
    closeParts.length > 0
      ? `Before the first patient, the site must own: ${closeParts.join(', ')} — every block ` +
        'above is evidence-linked where the protocol supports it, and every block requires ' +
        'human review before this outline is presented.'
      : 'Before the first patient, review every block above with the site — each requires ' +
        'human review before this outline is presented.',
  );
  pushSpeakerNote(
    state, 'before_first_patient',
    'Close by assigning each open item above to a named owner at the site.',
    'What does the site still need from the sponsor before first screening?',
  );

  return state.blocks;
}
