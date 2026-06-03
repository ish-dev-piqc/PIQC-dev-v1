// =============================================================================
// visitNameNormalize (Vite copy) — MUST stay byte-identical to the Deno copy at
// supabase/functions/_shared/visitNameNormalize.ts. The two runtimes can't share
// an import; a parity test (sourceEvidenceAdapter.test.ts) guards against drift,
// mirroring the normalizeDerivedText TS↔SQL precedent.
//
// Strips ONLY pure time/cycle parenthetical restatements from a visit name
// ("Treatment Visit 1 (Cycle 1 Day 1)" → "Treatment Visit 1") so name-variants
// collapse, while KEEPING semantic parentheticals ("(PK substudy)", "(±3 days)")
// — a false collapse (merging two real visits) is worse than a false split.
// =============================================================================

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

/** Canonical DISPLAY name (case preserved) — see the Deno copy for the contract. */
export function canonicalVisitName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/\s*\(([^()]*)\)/g, (full, inner) => (isPureTimeCycleParenthetical(inner) ? "" : full))
    .replace(/\s+/g, " ")
    .trim();
}

/** Dedup / grouping KEY: lowercased canonical name. Backward-compatible for
 *  names without a time/cycle parenthetical. */
export function normalizeVisitName(raw: string | null | undefined): string {
  return canonicalVisitName(raw).toLowerCase();
}
