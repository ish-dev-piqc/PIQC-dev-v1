import type {
  EndpointTier,
  ImpactSurface,
  RiskCandidateRule,
  SuggestionProvenance,
} from '../../types/audit';
import type { ConfidenceState, DraftReviewStatus } from '../../types/sotr';
import type { TaggedSection } from './mockProtocolRisks';

// =============================================================================
// Risk candidates — deterministic proposals from the parsed protocol.
//
// Pure module (no supabase import). Given the SOTR worksheet items of the
// audit's protocol, propose protocol risks for the auditor to confirm at
// Stage 1 (Intake). Every attribute of a proposal comes from the item's own
// coordinates and value shape — field_type, field_path, the visit object —
// never from reading the prose. No model call, no keyword rules: the
// protocol's own primary/secondary classification is the tier, and the
// operational domain is always the auditor's choice (left empty here, the
// form requires it).
//
// Candidates are derived on every mount and never stored. Accepting one
// writes a protocol_risk_objects row (tagging_mode PIQC_ASSISTED) whose
// source_extracted_item_id is the item — that link is what removes the
// candidate from the next derivation (see deriveRiskCandidates' dedupe).
//
// Rule table (the whole clinical assumption of this module, in one place):
//
//   rule                item                          tier       surface          time-sensitive
//   endpoint_primary    endpoint, primary_endpoints[  PRIMARY    DATA_INTEGRITY   no
//   endpoint_secondary  endpoint, secondary_endpoints[SECONDARY  DATA_INTEGRITY   no
//   dosing              dosing                        SAFETY     PATIENT_SAFETY   no
//   visit               visit with ≥1 procedure       SUPPORTIVE DATA_INTEGRITY   window ≠ 0
//   criterion           criterion                     SAFETY     BOTH             no
//
// Vendor Intake passes VENDOR_CANDIDATE_RULES (no criteria — eligibility is
// site-facing); the ISA risk-assessment stage adds `criterion`.
// =============================================================================

/** SOTR field types that can yield a candidate. The read API filters on
 *  this list; the derivation ignores anything else. */
export const CANDIDATE_FIELD_TYPES = ['endpoint', 'dosing', 'visit', 'criterion'] as const;

export const VENDOR_CANDIDATE_RULES: readonly RiskCandidateRule[] = [
  'endpoint_primary',
  'endpoint_secondary',
  'dosing',
  'visit',
];

/** A worksheet item as the candidate reader returns it — the SOTR row plus
 *  its primary evidence coordinates. Never carries quoted protocol text. */
export interface CandidateSourceItem {
  id: string;
  document_id: string;
  field_path: string;
  field_type: string;
  extracted_value: unknown;
  confidence_state: ConfidenceState;
  review_status: DraftReviewStatus | null;
  current_text: string | null;
  /** From the item's primary source-evidence link, when it has one. */
  section_number: string | null;
  page_number: number | null;
}

export interface RiskCandidate {
  /** The SOTR item this proposal comes from — one candidate per item. */
  source_extracted_item_id: string;
  rule: RiskCandidateRule;
  section_identifier: string;
  section_title: string;
  endpoint_tier: EndpointTier;
  impact_surface: ImpactSurface;
  time_sensitivity: boolean;
  /** SOTR coordinates carried into suggestion_provenance on accept. */
  field_path: string;
  field_type: string;
  confidence_state: ConfidenceState;
  document_id: string;
  /** Shown so the auditor knows whether the worksheet reviewer has looked
   *  at the item. Displayed, never required. */
  review_status: DraftReviewStatus | null;
  page_number: number | null;
  derived_at: string;
}

export interface RiskCandidateSet {
  candidates: RiskCandidate[];
  /** Items of a candidate type that produced no proposal: an endpoint under
   *  an unrecognised path, a non-text dosing/criterion value, a visit without
   *  a name or without procedures. Surfaced as a count so the auditor knows
   *  the list is not the whole worksheet. */
  skipped: number;
}

const TITLE_MAX = 120;
const DOSING_VALUE_MAX = 100;
const VISIT_PROCEDURES_SHOWN = 4;

const RULE_ORDER: Record<RiskCandidateRule, number> = {
  endpoint_primary: 0,
  endpoint_secondary: 1,
  dosing: 2,
  visit: 3,
  criterion: 4,
};

interface Proposal {
  endpoint_tier: EndpointTier;
  impact_surface: ImpactSurface;
  time_sensitivity: boolean;
  section_title: string;
  /** Visits only — drives their ordering. */
  study_day: number | null;
}

/**
 * Derive risk candidates from worksheet items.
 *
 * @param items    the protocol's worksheet items (any field types; only
 *                 CANDIDATE_FIELD_TYPES are considered)
 * @param tagged   risks already on the protocol version — an item that is
 *                 some risk's source_extracted_item_id is never proposed again
 * @param include  the rules this stage shows (VENDOR_CANDIDATE_RULES on
 *                 vendor Intake); excluded rules are dropped silently, not
 *                 counted as skipped
 * @param derivedAt ISO timestamp stamped on every candidate (injected so the
 *                 derivation stays pure)
 */
export function deriveRiskCandidates(
  items: CandidateSourceItem[],
  tagged: TaggedSection[],
  include: readonly RiskCandidateRule[],
  derivedAt: string,
): RiskCandidateSet {
  const taggedSourceIds = new Set<string>();
  for (const t of tagged) {
    if (t.source_extracted_item_id) taggedSourceIds.add(t.source_extracted_item_id);
  }

  // Sort keys ride alongside the candidate rather than on it, so the public
  // shape carries nothing the UI or provenance should not see.
  const rows: Array<{ candidate: RiskCandidate; day: number | null; index: number | null }> = [];
  let skipped = 0;

  for (const item of items) {
    if (!isCandidateFieldType(item.field_type)) continue;
    if (taggedSourceIds.has(item.id)) continue;

    const rule = ruleFor(item);
    if (rule === null) {
      skipped += 1;
      continue;
    }
    if (!include.includes(rule)) continue;

    const proposal = propose(rule, item);
    if (proposal === null) {
      skipped += 1;
      continue;
    }

    rows.push({
      candidate: {
        source_extracted_item_id: item.id,
        rule,
        section_identifier: sectionIdentifier(item),
        section_title: proposal.section_title,
        endpoint_tier: proposal.endpoint_tier,
        impact_surface: proposal.impact_surface,
        time_sensitivity: proposal.time_sensitivity,
        field_path: item.field_path,
        field_type: item.field_type,
        confidence_state: item.confidence_state,
        document_id: item.document_id,
        review_status: item.review_status ?? null,
        page_number: item.page_number ?? null,
        derived_at: derivedAt,
      },
      day: proposal.study_day,
      index: fieldPathIndex(item.field_path),
    });
  }

  // Primary → secondary → dosing → visits by study day → criteria; within a
  // rule, the protocol's own order (the [n] index of the field path).
  rows.sort((a, b) => {
    const byRule = RULE_ORDER[a.candidate.rule] - RULE_ORDER[b.candidate.rule];
    if (byRule !== 0) return byRule;
    if (a.candidate.rule === 'visit') {
      const byDay = compareNullableNumber(a.day, b.day);
      if (byDay !== 0) return byDay;
    }
    const byIndex = compareNullableNumber(a.index, b.index);
    if (byIndex !== 0) return byIndex;
    return a.candidate.field_path.localeCompare(b.candidate.field_path);
  });

  return { candidates: rows.map((r) => r.candidate), skipped };
}

/** The provenance record stored with a risk accepted from this candidate.
 *  Identifiers and the proposal only — no protocol text. */
export function candidateProvenance(candidate: RiskCandidate): SuggestionProvenance {
  return {
    source: 'sotr_item',
    rule: candidate.rule,
    field_path: candidate.field_path,
    field_type: candidate.field_type,
    confidence_state: candidate.confidence_state,
    document_id: candidate.document_id,
    proposed: {
      section_identifier: candidate.section_identifier,
      section_title: candidate.section_title,
      endpoint_tier: candidate.endpoint_tier,
      impact_surface: candidate.impact_surface,
      time_sensitivity: candidate.time_sensitivity,
    },
    derived_at: candidate.derived_at,
  };
}

// -----------------------------------------------------------------------------
// Rules
// -----------------------------------------------------------------------------

function isCandidateFieldType(fieldType: string): boolean {
  return (CANDIDATE_FIELD_TYPES as readonly string[]).includes(fieldType);
}

/** Which rule an item falls under, from its type and path alone. An endpoint
 *  outside the primary/secondary paths has no rule (skipped, not guessed). */
function ruleFor(item: CandidateSourceItem): RiskCandidateRule | null {
  switch (item.field_type) {
    case 'endpoint':
      if (item.field_path.startsWith('primary_endpoints[')) return 'endpoint_primary';
      if (item.field_path.startsWith('secondary_endpoints[')) return 'endpoint_secondary';
      return null;
    case 'dosing':
      return 'dosing';
    case 'visit':
      return 'visit';
    case 'criterion':
      return 'criterion';
    default:
      return null;
  }
}

function propose(rule: RiskCandidateRule, item: CandidateSourceItem): Proposal | null {
  switch (rule) {
    case 'endpoint_primary': {
      const text = itemText(item);
      if (text === null) return null;
      return {
        endpoint_tier: 'PRIMARY',
        impact_surface: 'DATA_INTEGRITY',
        time_sensitivity: false,
        section_title: clip(text, TITLE_MAX),
        study_day: null,
      };
    }
    case 'endpoint_secondary': {
      const text = itemText(item);
      if (text === null) return null;
      return {
        endpoint_tier: 'SECONDARY',
        impact_surface: 'DATA_INTEGRITY',
        time_sensitivity: false,
        section_title: clip(text, TITLE_MAX),
        study_day: null,
      };
    }
    case 'dosing': {
      const text = itemText(item);
      if (text === null) return null;
      return {
        endpoint_tier: 'SAFETY',
        impact_surface: 'PATIENT_SAFETY',
        time_sensitivity: false,
        section_title: `Dosing regimen — ${clip(text, DOSING_VALUE_MAX)}`,
        study_day: null,
      };
    }
    case 'criterion': {
      const text = itemText(item);
      if (text === null) return null;
      return {
        endpoint_tier: 'SAFETY',
        impact_surface: 'BOTH',
        time_sensitivity: false,
        section_title: clip(text, TITLE_MAX),
        study_day: null,
      };
    }
    case 'visit':
      return proposeVisit(item.extracted_value);
  }
}

/** Visit value shape as the ingest pipeline writes schedule_of_events
 *  entries: { visit_name, study_day, window_minus_days, window_plus_days,
 *  procedures: string[] , … }. A visit with no procedures carries nothing a
 *  vendor could be responsible for and is not proposed. */
function proposeVisit(value: unknown): Proposal | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;

  const name = typeof v.visit_name === 'string' ? v.visit_name.trim() : '';
  if (!name) return null;

  const procedures = Array.isArray(v.procedures)
    ? v.procedures.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : [];
  if (procedures.length === 0) return null;

  const day = typeof v.study_day === 'number' && Number.isFinite(v.study_day) ? v.study_day : null;
  const minus = typeof v.window_minus_days === 'number' ? v.window_minus_days : 0;
  const plus = typeof v.window_plus_days === 'number' ? v.window_plus_days : 0;

  const shown = procedures.slice(0, VISIT_PROCEDURES_SHOWN).map((p) => p.trim());
  const more = procedures.length - shown.length;
  const head = day === null ? name : `${name} — Day ${day} (${formatWindow(minus, plus)})`;
  const title = `${head} · ${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}`;

  return {
    endpoint_tier: 'SUPPORTIVE',
    impact_surface: 'DATA_INTEGRITY',
    // A visit window is the timing constraint the schedule imposes; a
    // zero-width window has none to breach.
    time_sensitivity: minus !== 0 || plus !== 0,
    section_title: clip(title, TITLE_MAX),
    study_day: day,
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** The item's display text: the reviewer's edit when one exists, else the
 *  extracted value when it is a string. Anything else is not proposable. */
function itemText(item: CandidateSourceItem): string | null {
  const edited = item.current_text?.trim();
  const raw = edited ? edited : item.extracted_value;
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  return text.length === 0 ? null : text;
}

/** Primary evidence section when the item has one, else the field path — an
 *  identifier the auditor can always trace back in the worksheet. */
function sectionIdentifier(item: CandidateSourceItem): string {
  const section = item.section_number?.trim();
  if (!section) return item.field_path;
  return section.startsWith('§') ? section : `§${section}`;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Same rendering as the SOTR worksheet row (WorksheetItemRow.formatVisit):
 *  symmetric windows collapse to ±Nd, asymmetric ones show both sides. */
function formatWindow(minus: number, plus: number): string {
  if (minus === plus) return `±${minus}d`;
  if (minus === 0) return `+${plus}d`;
  if (plus === 0) return `-${minus}d`;
  return `-${minus}/+${plus}d`;
}

/** The [n] index of a field path such as primary_endpoints[3], or null. */
function fieldPathIndex(fieldPath: string): number | null {
  const match = /\[(\d+)\]/.exec(fieldPath);
  return match ? Number(match[1]) : null;
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}
