// =============================================================================
// cohortExtraction — pure helpers that turn the Reducto-Extract `study_cohorts`
// field (+ its citations) into authoritative protocol_cohorts rows, and
// reconcile that list against the SoA schedule's cohort coverage + any
// prose-stated count.
//
// Lives apart from ingestPipeline (which can't be imported under vitest — it
// pulls Deno `https:` deps) so this logic is unit-tested. Pure: no I/O, no
// imports, vitest-importable.
//
// Two guarantees this supports:
//   (a) ALL cohorts appear OR the gap is flagged — never silently fewer. The
//       extracted list drives the Visit Prep selector (every cohort shows); the
//       reconcile flags any cohort the schedule doesn't cover / any count that
//       disagrees with the prose, so under-extraction surfaces for review.
//   (b) Evidence-gated — a cohort with no citation is kept but marked
//       has_evidence=false and flagged; cohorts are never invented (parse only
//       reads what the extraction returned).
// =============================================================================

export interface ExtractedCohort {
  label: string;
  dose_regimen: string | null;
  description: string | null;
  source_page: number | null;
  source_quote: string | null;
  /** false when the extraction attached no citation — surfaced by the reconcile. */
  has_evidence: boolean;
  /**
   * How this cohort appears in the SoA table headings/markers when that differs
   * from `label` — e.g. label 'CSF' → ['Cerebrospinal Fluid Cohort']. Drives
   * alias-aware per-visit binding in soaGridParser (an alias only ever resolves
   * to this cohort — never invents one). [] when the extraction stated none.
   */
  soa_aliases: string[];
}

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

/** Normalize an extracted string-array field (e.g. soa_aliases): trim each,
 * drop empties + case-insensitive dupes, preserve order. */
function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const s = asTrimmedString(item);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Normalized dedup key for a cohort label. */
function cohortKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Parse the reshaped Reducto-Extract `study_cohorts` array (+ its parallel
 * `_reducto_citations.study_cohorts`) into normalized, deduped cohort rows with
 * evidence. Order preserved (= the protocol's own cohort order → ordinal).
 * Entries with no usable label are dropped; a label with no citation is KEPT but
 * marked has_evidence=false so the reconcile can flag it (no silent invention,
 * no silent drop).
 */
export function parseStudyCohorts(
  extractedFields: Record<string, unknown> | null | undefined,
): ExtractedCohort[] {
  if (!extractedFields) return [];
  const raw = extractedFields.study_cohorts;
  if (!Array.isArray(raw)) return [];

  const citObj = extractedFields._reducto_citations;
  const cits =
    citObj && typeof citObj === "object" &&
      Array.isArray((citObj as Record<string, unknown>).study_cohorts)
      ? ((citObj as Record<string, unknown>).study_cohorts as unknown[])
      : [];

  const out: ExtractedCohort[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const label = asTrimmedString(e.label);
    if (!label) continue;
    const key = cohortKey(label);
    if (seen.has(key)) continue;
    seen.add(key);

    const cit = cits[i] && typeof cits[i] === "object" ? (cits[i] as Record<string, unknown>) : null;
    const pages = cit && Array.isArray(cit.pages)
      ? (cit.pages as unknown[]).filter((p): p is number => typeof p === "number")
      : [];
    const quote = cit ? asTrimmedString(cit.text) : null;

    out.push({
      label,
      dose_regimen: asTrimmedString(e.dose_regimen),
      description: asTrimmedString(e.description),
      source_page: pages.length ? pages[0] : null,
      source_quote: quote ? quote.slice(0, 500) : null,
      has_evidence: !!(cit && (pages.length || quote)),
      // Drop an alias that merely restates the label — the label already matches.
      soa_aliases: asStringArray(e.soa_aliases).filter((a) => a.toLowerCase() !== key),
    });
  }
  return out;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * Deterministic corroboration: a prose-stated cohort/arm count
 * ("six dose cohorts", "6 ascending-dose cohorts", "three treatment arms").
 * null when no count is clearly stated. Conservative — the number must sit
 * within ONE descriptive word of "cohorts"/"arms"/"dose groups" AND not be a
 * sectioning ordinal ("Part 1", "Table 2", "Phase 3"). The old {0,3}-word
 * window + no preceding guard read stray figures ("…Part 1 … cohorts") as a
 * count, flagging a bogus reconcile mismatch on correct multi-arm designs.
 */
export function parseStatedCohortCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const re =
    /(?<!\b(?:part|parts|table|figure|section|phase|day|week|visit|cycle|arm|arms|group|groups|cohort|cohorts)\s+)\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?:\s+[a-z-]+)?\s+(?:dose\s+|treatment\s+)?(?:cohorts|arms|dose\s+groups)\b/i;
  const m = text.match(re);
  if (!m) return null;
  const tok = m[1].toLowerCase();
  const n = /^\d+$/.test(tok) ? parseInt(tok, 10) : (NUMBER_WORDS[tok] ?? null);
  return n != null && n >= 1 && n <= 50 ? n : null;
}

export interface CohortReconciliation {
  consistent: boolean;
  cohort_count: number;
  /** how many extracted cohorts the SoA schedule references (shared backbone ⇒ all). */
  covered_count: number;
  /** deterministic prose count, if stated. */
  stated_count: number | null;
  notes: string[];
}

/**
 * Reconcile the extracted cohort list against (a) the cohorts the SoA schedule
 * actually references (`scheduleCohorts` = union of per-visit `applies_to`) plus
 * a shared-backbone flag (a visit with `applies_to=null` applies to EVERY
 * cohort, so it covers all), and (b) an optional prose-stated count. Flags —
 * never hides — divergence so the guarantee is "all cohorts appear OR the gap is
 * flagged":
 *   • stated count ≠ extracted count  → "prose states N; extraction found M"
 *   • an extracted cohort no schedule references (only a real gap when there is
 *     NO shared backbone) → "K of M cohort(s) have no schedule coverage"
 *   • an ORPHAN schedule ref — the schedule scopes a visit to a cohort token
 *     that matches no extracted cohort → "schedule references … not in the
 *     extracted list". This fires regardless of a shared backbone: the old code
 *     took a blanket `covered = all` shortcut when any backbone existed, which
 *     silently MASKED a mis-bound / under-extracted cohort. Computing it
 *     independently is the fix.
 *   • a cohort with no citation evidence → "K cohort(s) lack a source citation"
 * Pure; the caller persists `notes` (on documents.extracted_fields + a log) so
 * nothing is silently dropped.
 */
export function reconcileCohorts(
  extracted: readonly ExtractedCohort[],
  scheduleCohorts: readonly string[],
  scheduleHasSharedBackbone: boolean,
  statedCount: number | null,
): CohortReconciliation {
  const notes: string[] = [];
  const labels = extracted.map((c) => c.label);
  const cohort_count = labels.length;
  const labelSet = new Set(labels.map((l) => l.toLowerCase()));
  const refs = new Set(scheduleCohorts.map((s) => s.toLowerCase()));

  // A shared-backbone visit genuinely applies to every cohort, so it covers
  // all — we keep that (dropping it would over-flag every clean shared schedule,
  // i.e. reconcile noise). What it must NOT do is mask an orphan ref (below).
  const covered_count = scheduleHasSharedBackbone
    ? cohort_count
    : labels.filter((l) => refs.has(l.toLowerCase())).length;

  if (statedCount != null && cohort_count > 0 && statedCount !== cohort_count) {
    notes.push(`protocol prose states ${statedCount} cohort(s); extraction found ${cohort_count}`);
  }
  // An extracted cohort the schedule never names — only a gap without a backbone.
  if (!scheduleHasSharedBackbone && cohort_count > 0 && covered_count < cohort_count) {
    notes.push(`${cohort_count - covered_count} of ${cohort_count} cohort(s) have no schedule coverage`);
  }
  // Orphan schedule ref: a cohort token the schedule scopes to but that matches
  // no extracted cohort — mis-binding or an under-extracted cohort. Independent
  // of the backbone (the false-pass the blanket shortcut used to hide).
  const orphanRefs = [...new Set(scheduleCohorts)].filter((s) => !labelSet.has(s.toLowerCase()));
  if (orphanRefs.length > 0) {
    notes.push(
      `schedule references ${orphanRefs.length} cohort scope(s) not in the extracted list: ${orphanRefs.join(", ")}`,
    );
  }
  const noEvidence = extracted.filter((c) => !c.has_evidence).length;
  if (noEvidence > 0) {
    notes.push(`${noEvidence} cohort(s) lack a source citation`);
  }

  return {
    consistent: notes.length === 0,
    cohort_count,
    covered_count,
    stated_count: statedCount,
    notes,
  };
}
