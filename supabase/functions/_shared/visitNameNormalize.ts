// =============================================================================
// visitNameNormalize — pure helper shared by the ingest pipeline + SOTR adapter.
//
// Reducto emits the same visit under many name strings that differ ONLY by a
// time/cycle restatement in parentheses: "Treatment Visit 1",
// "Treatment Visit 1 (Cycle 1 Day 1)", "...(Day 1, Cycle 1)", "...(Week 0)".
// `canonicalVisitName` strips ONLY those pure time/cycle parentheticals (the day
// is already carried by study_day), so the variants collapse to one canonical
// DISPLAY name (case preserved). Semantic parentheticals — "(PK substudy)",
// "(Unscheduled)", "(±3 days)" — are KEPT: dropping them could merge genuinely
// different visits, and a false collapse is worse than a false split.
//
// `normalizeVisitName` is the lowercased KEY used for dedup / prune / lookup.
//
// Pure: no I/O, no imports, vitest-importable. MUST stay byte-identical to the
// Vite-side copy `normalizeVisitName` in src/lib/sotr/sourceEvidenceAdapter.ts
// (the two runtimes can't share an import) — a parity test guards this, mirroring
// the normalizeDerivedText TS↔SQL precedent.
// =============================================================================

/**
 * True when a parenthetical's inner text is purely a time/cycle restatement
 * (cycle/day/week/month/visit words + numbers + separators, nothing else) AND
 * carries no window/range qualifier. Such groups are redundant with study_day.
 */
function isPureTimeCycleParenthetical(inner: string): boolean {
  // A window/range qualifier (± / +/- / "to") is clinically meaningful — keep it.
  if (/±|\+\/-|\bto\b/i.test(inner)) return false;
  const residue = inner
    .toLowerCase()
    .replace(/\b(cycles?|days?|weeks?|months?|visits?)\b/g, " ")
    .replace(/-?\d+/g, " ")
    .replace(/[,&/]|\band\b/g, " ")
    .replace(/\s+/g, "");
  return residue.length === 0 && inner.trim().length > 0;
}

/**
 * Canonical DISPLAY name: strip pure time/cycle parentheticals, collapse
 * whitespace, trim. Case preserved — this is what gets stored as `visit_name`.
 */
export function canonicalVisitName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/\s*\(([^()]*)\)/g, (full, inner) => (isPureTimeCycleParenthetical(inner) ? "" : full))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Dedup / prune / lookup KEY: lowercased canonical name. For names without a
 * time/cycle parenthetical this equals the legacy `trim().toLowerCase()
 * .replace(/\s+/g,' ')` behavior, so it is backward-compatible.
 */
export function normalizeVisitName(raw: string | null | undefined): string {
  return canonicalVisitName(raw).toLowerCase();
}
