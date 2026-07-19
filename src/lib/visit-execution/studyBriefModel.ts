import type { DivergenceRecord } from '../../types/divergence';
import type {
  ProtocolCohort,
  VisitExecutionWorkspace,
} from '../../types/visit-execution';

// =============================================================================
// studyBriefModel — pure builder for the Study overview (narrative-first
// S1.6): the reading pattern one level up. A coordinator opening a protocol
// gets the study's SHAPE before picking a visit — how many visits over what
// span, which cohorts on what dose, where the protocol disagrees with itself.
//
// DETERMINISTIC. Every value is derived from fields the workspace already
// loads; the orient line is mechanical assembly, not composition — which is
// why the UI labels it "Derived from the parsed schedule", NOT "PIQC drafted"
// (that label is reserved for composed prose, per the attribution doctrine).
// =============================================================================

export interface StudyArcEntry {
  visit_template_id: string;
  visit_name: string;
  /** "Day +22" / "Day -14" — same convention as the snapshot card. */
  dayLabel: string;
  /** "±3 days" / "−1/+2 days" / null when the schedule states no window. */
  windowLabel: string | null;
  isDosing: boolean;
  /** Cohort labels, empty = shared visit. */
  appliesTo: string[];
  /** Rare-loud markers only (rail discipline). */
  hasSafetyCritical: boolean;
  endpointCriticalCount: number;
  conditionalCount: number;
}

export interface StudyCohortEntry {
  label: string;
  doseRegimen: string | null;
  description: string | null;
  sourcePage: number | null;
  /** Visits visible under this cohort (its own + shared/unscoped ones). */
  visitCount: number;
}

export interface StudyBrief {
  /** One derived sentence — the study's shape. */
  orient: string;
  arc: StudyArcEntry[];
  cohorts: StudyCohortEntry[];
  /** open + raised_with_sponsor only. */
  openDivergenceCount: number;
}

function dayLabel(day: number): string {
  return day >= 0 ? `Day +${day}` : `Day ${day}`;
}

function windowLabel(minus: number, plus: number): string | null {
  if (minus === 0 && plus === 0) return null;
  if (minus === plus) return `±${plus} day${plus === 1 ? '' : 's'}`;
  return `−${minus}/+${plus} days`;
}

/**
 * The derived orient sentence. Mechanical assembly — counts and spans only,
 * so it can never claim something the schedule doesn't state.
 *
 * "14 visits from Day -14 to Day +85 · 3 cohorts · 6 dosing visits"
 * (segments drop out when they'd be noise: single-cohort studies don't
 * mention cohorts; a no-dosing protocol doesn't mention dosing).
 */
export function buildStudyOrient(
  workspaces: readonly VisitExecutionWorkspace[],
  cohortCount: number,
): string {
  if (workspaces.length === 0) return 'No visits parsed yet for this protocol.';
  const days = workspaces.map((w) => w.snapshot.study_day);
  const span = `${dayLabel(Math.min(...days))} to ${dayLabel(Math.max(...days))}`;
  const segments = [
    `${workspaces.length} visit${workspaces.length === 1 ? '' : 's'} from ${span}`,
  ];
  if (cohortCount >= 2) {
    segments.push(`${cohortCount} cohorts`);
  }
  const dosing = workspaces.filter((w) => w.snapshot.is_dosing_visit).length;
  if (dosing > 0) {
    segments.push(`${dosing} dosing visit${dosing === 1 ? '' : 's'}`);
  }
  return segments.join(' · ');
}

export function buildStudyBrief(
  workspaces: readonly VisitExecutionWorkspace[],
  cohorts: readonly ProtocolCohort[],
  divergences: readonly DivergenceRecord[],
): StudyBrief {
  // Arc — sorted by study day (the adapter already sorts, but the study
  // view's whole claim is chronological shape; don't inherit the invariant,
  // enforce it).
  const arc: StudyArcEntry[] = [...workspaces]
    .sort((a, b) => a.snapshot.study_day - b.snapshot.study_day)
    .map((w) => ({
      visit_template_id: w.visit_template_id,
      visit_name: w.snapshot.visit_name,
      dayLabel: dayLabel(w.snapshot.study_day),
      windowLabel: windowLabel(
        w.snapshot.window_minus_days,
        w.snapshot.window_plus_days,
      ),
      isDosing: w.snapshot.is_dosing_visit,
      appliesTo: w.snapshot.applies_to ?? [],
      hasSafetyCritical: w.snapshot.has_safety_critical,
      endpointCriticalCount: w.snapshot.endpoint_critical_count,
      conditionalCount: w.snapshot.conditional_item_count,
    }));

  // Cohorts — the authoritative protocol_cohorts list in the protocol's own
  // order, each with the count of visits a member of that cohort attends
  // (its scoped visits + every shared/unscoped visit — the same "null →
  // all" convention as the cohort filter).
  const cohortEntries: StudyCohortEntry[] = [...cohorts]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((c) => ({
      label: c.label,
      doseRegimen: c.dose_regimen,
      description: c.description,
      sourcePage: c.source_page,
      visitCount: workspaces.filter(
        (w) =>
          w.snapshot.applies_to == null ||
          w.snapshot.applies_to.includes(c.label),
      ).length,
    }));

  return {
    orient: buildStudyOrient(workspaces, cohortEntries.length),
    arc,
    cohorts: cohortEntries,
    openDivergenceCount: divergences.filter(
      (d) => d.status === 'open' || d.status === 'raised_with_sponsor',
    ).length,
  };
}
