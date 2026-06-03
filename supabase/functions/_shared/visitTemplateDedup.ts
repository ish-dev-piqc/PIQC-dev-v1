// =============================================================================
// visitTemplateDedup — pure helper shared by the ingest pipeline.
//
// Reducto often emits the same visit twice in schedule_of_events: once from the
// inline narrative section (rich — real visit windows, fuller procedures) and
// once from the SoA grid table (sparse). The old template dedup collapsed by
// (visit_name, study_day) with "last occurrence wins", which could keep the
// poorer SoA-table instance. This helper instead keeps the QUALITY winner —
// the instance with a visit window, then the one with more procedures — so the
// visit-template / Visit-Prep layer stores the SAME instance the Protocol tab
// renders (the SOTR adapter's dedupeVisitArray uses the same window preference).
//
// Pure: no I/O, no imports, easy to vitest. Generic over the row shape so the
// caller's exact row type flows through unchanged.
// =============================================================================

export interface DedupableVisitRow {
  visit_name: string;
  study_day: number;
  window_minus_days: number;
  window_plus_days: number;
  procedures: string[];
}

/**
 * Canonical template identity key. MUST match the upsert's onConflict target
 * (protocol_id, visit_name, study_day) so dedup, the DB unique constraint, and
 * the re-ingest prune all agree on what "the same visit" is.
 */
export function templateKey(r: { visit_name: string; study_day: number }): string {
  return `${r.visit_name}|${r.study_day}`;
}

/**
 * Collapse duplicate (visit_name, study_day) rows to one quality winner each.
 * Preference order: wider total window > more procedures > first seen.
 * Input order is otherwise preserved (first occurrence of each key sets slot).
 */
export function dedupeVisitTemplateRowsByQuality<T extends DedupableVisitRow>(
  rows: readonly T[],
): T[] {
  const winnerByKey = new Map<string, T>();
  for (const r of rows) {
    const key = templateKey(r);
    const cur = winnerByKey.get(key);
    if (!cur) {
      winnerByKey.set(key, r);
      continue;
    }
    const curScore = cur.window_minus_days + cur.window_plus_days;
    const rScore = r.window_minus_days + r.window_plus_days;
    if (rScore > curScore) {
      winnerByKey.set(key, r);
    } else if (rScore === curScore && r.procedures.length > cur.procedures.length) {
      winnerByKey.set(key, r);
    }
  }
  return Array.from(winnerByKey.values());
}

/**
 * IDs of templates already stored for a document that are NOT in the freshly
 * extracted (deduped) set — stale rows left by a prior, differently-named
 * extraction run. Deleting these on re-ingest keeps the template set
 * idempotent: Reducto's non-deterministic naming would otherwise accumulate a
 * new variant row per ingest (one doc re-ingested 6× → 36 rows for ~15 visits).
 *
 * Pure: caller passes the doc's existing rows + the kept batch and gets back the
 * ids to delete. Uses templateKey so it can't drift from dedup / the constraint.
 */
export function staleTemplateIds<E extends { id: string; visit_name: string; study_day: number }>(
  existing: readonly E[],
  kept: readonly DedupableVisitRow[],
): string[] {
  const keptKeys = new Set(kept.map(templateKey));
  return existing.filter((e) => !keptKeys.has(templateKey(e))).map((e) => e.id);
}
