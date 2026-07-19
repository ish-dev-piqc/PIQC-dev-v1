import type { DivergenceRecord } from '../../types/divergence';
import type {
  VisitExecutionItem,
  VisitExecutionWorkspace,
} from '../../types/visit-execution';

// =============================================================================
// visitBriefModel — pure builder for the Visit Brief (narrative-first landing,
// slice 1). Assembles the reading a coordinator sees when a visit opens:
// what the visit is for, who it applies to, when it runs, what gates it, and
// where the protocol disagrees with itself.
//
// DETERMINISTIC BY DESIGN. Every line is template-assembled from fields the
// ingest pipeline already extracted — this is the vendor lane's `templated`
// provenance rung. No LLM call happens here; the future refine pass (slice 2)
// adds an `llm` rung behind a per-sentence cite-or-withhold gate, exactly the
// ISA report's anchor-gate pattern.
//
// CITATION DISCIPLINE (the litmus): a ref is attached to a line ONLY when the
// source actually supports that specific claim. Gate lines cite the
// condition's own source_section/source_page — never the parent item's SoA
// source_quote, which evidences the requirement's existence, not the rule.
// The item-level quote belongs to the sequence node / traceability drawer.
// =============================================================================

/** Where-in-the-protocol reference backing one brief line. */
export interface VisitBriefRef {
  /** Chip label, e.g. "§7.3.1 · p 42" — see formatBriefWhere. */
  label: string;
  section: string | null;
  page: number | null;
}

export type VisitBriefLineKind =
  | 'orient'
  | 'scope'
  | 'clock'
  | 'gate'
  | 'timed'
  | 'more'
  | 'watchout';

export interface VisitBriefLine {
  /** Stable key for React lists + tests. */
  key: string;
  kind: VisitBriefLineKind;
  text: string;
  refs: VisitBriefRef[];
  /**
   * True when the line's prose originated from PIQC's ingest extraction
   * (the visit purpose) rather than mechanical field assembly. Drives the
   * per-line attribution treatment in VisitBriefBlock.
   */
  piqcDrafted: boolean;
}

/**
 * Cap on gate/timed lines each. The brief is the shape of the visit, not the
 * full enumeration — the sequence block below it renders every requirement.
 * When the cap trims, an explicit 'more' line names the trimmed count
 * (honesty over silent truncation).
 */
export const BRIEF_LINE_CAP = 3;

/** "§7.3.1 · p 42" / "§7.3.1" / "p 42" / null when the source is unlocated. */
export function formatBriefWhere(
  section: string | null,
  page: number | null,
): string | null {
  const sec = section?.trim() ? `§${section.trim().replace(/^§\s*/, '')}` : null;
  const pg = page !== null ? `p ${page}` : null;
  if (sec && pg) return `${sec} · ${pg}`;
  return sec ?? pg;
}

function refFrom(section: string | null, page: number | null): VisitBriefRef | null {
  const label = formatBriefWhere(section, page);
  return label ? { label, section, page } : null;
}

/** Study-day display shared with the snapshot card's convention (+N / -N). */
function formatStudyDay(day: number): string {
  return day >= 0 ? `Day +${day}` : `Day ${day}`;
}

function formatWindow(minus: number, plus: number): string | null {
  if (minus === 0 && plus === 0) return null;
  if (minus === plus) return `±${plus} day${plus === 1 ? '' : 's'}`;
  return `−${minus}/+${plus} days`;
}

/** First sentence of a condition/consequence pair, compacted for the brief. */
function gateSentence(item: VisitExecutionItem): string {
  const c = item.conditions[0];
  const extra = item.conditions.length - 1;
  const tail = extra > 0 ? ` (+${extra} more condition${extra === 1 ? '' : 's'})` : '';
  return `${item.label} — if ${c.condition_text}, then ${c.consequence_text}${tail}`;
}

/**
 * Build the Visit Brief for one workspace. `visitDivergences` is the
 * already-visit-scoped list VisitExecutionTab derives for the DivergencePanel
 * (protocol-wide cohort_scope records included by that scoping rule).
 */
export function buildVisitBrief(
  workspace: VisitExecutionWorkspace,
  visitDivergences: readonly DivergenceRecord[],
): VisitBriefLine[] {
  const { snapshot, items } = workspace;
  const lines: VisitBriefLine[] = [];

  // ORIENT — the visit's purpose, as PIQC drafted it at ingest. Rendered even
  // when it is the thin-adapter placeholder: an honest "pending extraction"
  // beats a silently absent opening line.
  lines.push({
    key: 'orient',
    kind: 'orient',
    text: snapshot.purpose,
    refs: [],
    piqcDrafted: true,
  });

  // SCOPE — only for cohort-scoped visits. Null applies_to = shared visit;
  // saying "applies to everyone" would be wallpaper.
  if (snapshot.applies_to && snapshot.applies_to.length > 0) {
    const labels = snapshot.applies_to.join(', ');
    lines.push({
      key: 'scope',
      kind: 'scope',
      text: `Applies to ${labels} only.`,
      refs: [],
      piqcDrafted: false,
    });
  }

  // CLOCK — study day + visit window. Window omitted when the schedule
  // states none (0/0) rather than inventing "±0".
  const window = formatWindow(snapshot.window_minus_days, snapshot.window_plus_days);
  lines.push({
    key: 'clock',
    kind: 'clock',
    text: window
      ? `Scheduled at Study ${formatStudyDay(snapshot.study_day)}, window ${window}.`
      : `Scheduled at Study ${formatStudyDay(snapshot.study_day)}.`,
    refs: [],
    piqcDrafted: false,
  });

  // GATES — requirements with if/then rules. Capped; the trimmed remainder is
  // named explicitly. Ref = the condition's OWN source only (see header).
  const gated = items.filter((i) => i.conditions.length > 0);
  for (const item of gated.slice(0, BRIEF_LINE_CAP)) {
    const c = item.conditions[0];
    const ref = refFrom(c.source_section, c.source_page);
    lines.push({
      key: `gate-${item.id}`,
      kind: 'gate',
      text: gateSentence(item),
      refs: ref ? [ref] : [],
      piqcDrafted: false,
    });
  }

  // TIMED — hard timing constraints beyond the visit window (e.g. "PK within
  // 30 min of dosing"). Soft constraints stay in the sequence — the brief
  // carries only what can cause a deviation. Items already surfaced as gate
  // lines are skipped (their sentence carries the sharper claim).
  const gatedIds = new Set(gated.slice(0, BRIEF_LINE_CAP).map((i) => i.id));
  const timed = items.filter(
    (i) => i.timing?.is_hard_constraint && !gatedIds.has(i.id),
  );
  for (const item of timed.slice(0, BRIEF_LINE_CAP)) {
    const t = item.timing!;
    const ref = refFrom(t.source_section, null);
    lines.push({
      key: `timed-${item.id}`,
      kind: 'timed',
      text: `${item.label} — ${t.label}.`,
      refs: ref ? [ref] : [],
      piqcDrafted: false,
    });
  }

  // MORE — honest cap line. One line covers both trims.
  const trimmed =
    Math.max(0, gated.length - BRIEF_LINE_CAP) +
    Math.max(0, timed.length - BRIEF_LINE_CAP);
  if (trimmed > 0) {
    lines.push({
      key: 'more',
      kind: 'more',
      text: `${trimmed} more conditional or timed requirement${
        trimmed === 1 ? '' : 's'
      } — every one is in the sequence below.`,
      refs: [],
      piqcDrafted: false,
    });
  }

  // WATCH-OUT — the protocol disagreeing with itself. Counts only open
  // records: a resolved/dismissed divergence is settled history, and a
  // raised_with_sponsor one is still live for scheduling risk.
  const live = visitDivergences.filter(
    (d) => d.status === 'open' || d.status === 'raised_with_sponsor',
  );
  if (live.length > 0) {
    lines.push({
      key: 'watchout',
      kind: 'watchout',
      text:
        live.length === 1
          ? 'The protocol gives two readings of one detail on this visit — both are shown in the divergence panel below.'
          : `The protocol gives conflicting readings on ${live.length} details of this visit — all are shown in the divergence panel below.`,
      refs: [],
      piqcDrafted: false,
    });
  }

  return lines;
}
