// =============================================================================
// visitScheduleRules — pure schedule-quality helpers shared by the ingest
// pipeline. No I/O, no imports, vitest-importable.
//
//   #3a detectImplausibleDay  — flag visits whose study_day contradicts their
//        name (EOT/EOS/Follow-up dated early; Screening/Baseline dated late).
//   #3b expandAggregateVisitRow — turn "Treatment Visits 2,3,4,5,6 (Weeks
//        2,4,6,8,10)" into individual visits by PARSING the stated week pairing
//        (never guessing); flag when it can't be parsed cleanly.
//   #4  reconcileVisitSequence — deterministic completeness: find gaps in a
//        numbered series (we have Visit 1,2,3,4,7,8 → 5,6 are missing).
//
// All findings are review signals — nothing here auto-corrects a day or
// fabricates a visit. A false collapse / wrong day is worse than a flagged gap.
// =============================================================================

export interface ScheduleGap {
  gap_text: string;
  source_section: string | null;
  source_page: number | null;
  detection_confidence: "high" | "medium" | "low" | "needs_review";
  detection_reason: string;
}

// NOTE: "follow-up" is intentionally NOT here — follow-ups legitimately span
// the whole post-treatment tail, so flagging them produces false positives.
const LATE_VISIT = /\b(eot|eos|end[ -]of[ -](treatment|study)|final visit|early termination)\b/i;
const EARLY_VISIT = /\b(screening|baseline|run[ -]?in|enrol)/i;

/**
 * #3a — flag a study_day that contradicts the visit's name, scaled by the
 * schedule's own span so it generalizes across protocols. Returns null when
 * plausible. Never corrects the day.
 */
export function detectImplausibleDay(
  visitName: string,
  studyDay: number,
  maxStudyDay: number,
): ScheduleGap | null {
  if (!Number.isFinite(studyDay) || maxStudyDay <= 0) return null;
  // LATE-named visits legitimately sit mid-study when there's a long follow-up
  // tail (end-of-TREATMENT precedes follow-up), so flag them ONLY at/near
  // baseline in a study that clearly runs much longer — that's the real garble
  // (EOT extracted at day 0/14 when the true EOT is day 169). Absolute, not
  // relative to max, so a legit mid-study EOT (e.g. day 169 of 672) is NOT flagged.
  if (LATE_VISIT.test(visitName) && maxStudyDay >= 60 && studyDay <= 14) {
    return {
      gap_text: `"${visitName}" is dated study day ${studyDay} — implausibly early for an end-of-treatment/study visit in a study that runs to day ${maxStudyDay}. Verify the visit's day.`,
      source_section: null,
      source_page: null,
      detection_confidence: "needs_review",
      detection_reason: "implausible_study_day",
    };
  }
  if (EARLY_VISIT.test(visitName) && studyDay > Math.max(7, 0.25 * maxStudyDay)) {
    return {
      gap_text: `"${visitName}" is dated study day ${studyDay}, implausibly late for a screening/baseline visit. Verify the visit's day.`,
      source_section: null,
      source_page: null,
      detection_confidence: "needs_review",
      detection_reason: "implausible_study_day",
    };
  }
  return null;
}

/** Parse "2, 3, 4", "7-12", "7,8,9 and 10" → [2,3,4] / [7..12] / [7,8,9,10]. */
function parseIntList(s: string): number[] {
  const out: number[] = [];
  for (const part of s.split(/,|&|\band\b/i)) {
    const t = part.trim();
    const range = t.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      for (let i = +range[1]; i <= +range[2]; i++) out.push(i);
    } else {
      const m = t.match(/\d+/);
      if (m) out.push(+m[0]);
    }
  }
  return out;
}

export interface ExpandedVisit {
  visit_name: string;
  study_day: number;
}

/**
 * #3b — expand an aggregate row IFF the name explicitly enumerates ≥2 visit
 * numbers AND a same-count parenthetical week/day list. Parses STATED values
 * (week→day = ×7); never guesses. Returns:
 *   { expanded } — individual visits to use instead of the aggregate row
 *   { flag }     — looks aggregate but can't be expanded cleanly → leave + flag
 *   null         — not an aggregate row
 */
export function expandAggregateVisitRow(
  visitName: string,
): { expanded: ExpandedVisit[] } | { flag: ScheduleGap } | null {
  if (!/\bvisits\b/i.test(visitName)) return null; // singular "Visit" → not an aggregate

  const flagged = (msg: string): { flag: ScheduleGap } => ({
    flag: {
      gap_text: `"${visitName}" ${msg}`,
      source_section: null,
      source_page: null,
      detection_confidence: "needs_review",
      detection_reason: "aggregate_visit_unexpanded",
    },
  });

  const head = visitName.replace(/\([^)]*\)/g, " "); // strip parens for the visit-number parse
  const visitsMatch = head.match(/\bvisits\b\s*([0-9,\s&–-]+(?:\band\b[0-9,\s&–-]*)*)/i);
  const visitNums = visitsMatch ? parseIntList(visitsMatch[1]) : [];
  if (visitNums.length < 2) return null; // not an enumeration of ≥2 visits

  const periodMatch = visitName.match(/\((weeks?|days?)\s*([0-9,\s&–-]+(?:\band\b[0-9,\s&–-]*)*)\)/i);
  if (!periodMatch) {
    return flagged("looks like an aggregate of multiple visits but has no week/day mapping to expand — split it into individual visits.");
  }
  const periods = parseIntList(periodMatch[2]);
  if (periods.length !== visitNums.length) {
    return flagged(`enumerates ${visitNums.length} visits but ${periods.length} ${periodMatch[1].toLowerCase()} — split it into individual visits.`);
  }

  const prefix = head.slice(0, head.toLowerCase().indexOf("visits")).trim();
  const mult = /days?/i.test(periodMatch[1]) ? 1 : 7;
  const expanded = visitNums.map((n, i) => ({
    visit_name: `${prefix} Visit ${n}`.replace(/\s+/g, " ").trim(),
    study_day: periods[i] * mult,
  }));
  return { expanded };
}

export interface CoverageGap {
  label: string;
  reason: string;
  source: "sequence";
}

/**
 * #4 (deterministic) — find gaps in a numbered visit series. Groups names by
 * their "<prefix> Visit|Cycle" stem, then within each series with ≥2 members
 * reports any integer missing between min and max. Catches the Visit-5/6 case.
 */
export function reconcileVisitSequence(visitNames: readonly string[]): CoverageGap[] {
  const present = new Map<string, Set<number>>();
  const label = new Map<string, string>();
  for (const raw of visitNames) {
    const m = raw.match(/^(.*?\b(?:visit|cycle))s?\s*#?\s*(\d+)\b/i);
    if (!m) continue;
    const stem = m[1].replace(/\s+/g, " ").trim();
    const key = stem.toLowerCase();
    if (!present.has(key)) {
      present.set(key, new Set());
      label.set(key, stem);
    }
    present.get(key)!.add(+m[2]);
  }

  const gaps: CoverageGap[] = [];
  for (const [key, nums] of present) {
    if (nums.size < 2) continue; // need ≥2 to infer a contiguous series
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    for (let n = min; n <= max; n++) {
      if (!nums.has(n)) {
        gaps.push({
          label: `${label.get(key)} ${n}`,
          reason: `expected in the "${label.get(key)}" series (${min}–${max}) but no visit was created`,
          source: "sequence",
        });
      }
    }
  }
  return gaps;
}
