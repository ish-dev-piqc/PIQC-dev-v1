// =============================================================================
// soaColumnCount — pure: derive an INDEPENDENT expected-visit-count signal from
// the parsed chunks, so the SoA-grid parse can be cross-checked against a second
// source. If the grid finds far fewer numbered visits than the protocol text
// mentions, the grid missed columns → fall back (gate check #2 in soaGridParser).
//
// Deliberately a different signal from the grid: it scans inline prose for
// "Treatment Visit N" / "Visit N" / "Cycle N" references rather than reading the
// table. Two independent estimates that agree → high confidence; that diverge →
// flag. Pure, no I/O, vitest-importable.
// =============================================================================

export interface VisitCountSignal {
  /** Highest N seen in "Visit N" / "Treatment Visit N". */
  maxVisitNumber: number;
  /** Highest N seen in "Cycle N" (treatment visits are usually 1-per-cycle). */
  maxCycleNumber: number;
  /** Count of DISTINCT numbered visits mentioned. */
  distinctVisitNumbers: number;
  /** Best independent lower-bound on the number of treatment visits. */
  estimatedTreatmentVisits: number;
}

export function deriveVisitCountSignal(
  chunks: ReadonlyArray<{ content?: string | null }>,
): VisitCountSignal {
  const visitNumbers = new Set<number>();
  let maxVisitNumber = 0;
  let maxCycleNumber = 0;

  for (const c of chunks) {
    const text = typeof c?.content === "string" ? c.content : "";
    if (!text) continue;
    // "Visit 12", "Treatment Visit 7", "TV5", "Visit #3"
    for (const m of text.matchAll(/\b(?:treatment\s+visit|visit|tv)\s*#?\s*(\d{1,2})\b/gi)) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 60) {
        visitNumbers.add(n);
        if (n > maxVisitNumber) maxVisitNumber = n;
      }
    }
    // "Cycle 12" — bounds the treatment-visit series for cycle-based schedules.
    for (const m of text.matchAll(/\bcycle\s*(\d{1,2})\b/gi)) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 60 && n > maxCycleNumber) maxCycleNumber = n;
    }
  }

  return {
    maxVisitNumber,
    maxCycleNumber,
    distinctVisitNumbers: visitNumbers.size,
    estimatedTreatmentVisits: Math.max(maxVisitNumber, maxCycleNumber),
  };
}
