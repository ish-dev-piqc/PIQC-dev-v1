// =============================================================================
// studyDayCoerce — pure helper shared by the ingest pipeline.
//
// `study_day` is schema-typed integer, but Reducto extraction can still hand
// back a numeric string ("57") or a "Day N" phrasing ("Day 168 ± 7"). The old
// ingest guard `typeof study_day === "number"` silently DROPPED any such visit
// from the template batch, so visits whose day arrived as text — commonly the
// trailing End-of-Treatment / Follow-up visits — vanished from Visit Prep while
// the Protocol/SOTR tab (which coerces via toNumber) still showed them.
//
// Conservative on purpose: recovers only unambiguous forms and otherwise
// returns null, so the caller can drop-WITH-A-WARNING rather than guess a
// clinical day value. The ambiguous tail ("Week 24", "30 days post last dose")
// is what the LLM schedule-completeness pass / human review is for — not a regex.
//
// Pure: no I/O, no imports, easy to vitest (mirrors visitTemplateDedup.ts).
// =============================================================================

/**
 * Coerce a Reducto-extracted `study_day` value into an integer day offset.
 *
 * Recovered:    42, "42", "-14", "Day 1", "Day -14", "Day 168 ± 7", "168+7"
 * Returns null: "Week 24", "30 days post last dose", "1 to 28", "Screening",
 *               "", null, NaN, and any non-number / non-string input.
 */
export function coerceStudyDay(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.trunc(raw) : null;
  if (typeof raw === "string") {
    // Optional "Day" prefix (colon separator only — a dash is a negative sign,
    // not a separator), a signed integer, an optional "± N" / "+ N" window, an
    // optional trailing "day(s)" — and nothing else. Anchored at both ends so
    // partial matches like "30 days post last dose" or "Week 24" are rejected.
    const m = raw.trim().match(/^(?:day\s*:?\s*)?([+-]?\d+)\s*(?:[±+]\s*\d+\s*)?(?:days?)?$/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}
