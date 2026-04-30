// =============================================================================
// Heatmap utilities — soft gradient indicators surfacing cross-study friction
// patterns ("places where things commonly go wrong").
//
// Per the UX spec: subtle, not alarming. Network-level intelligence is the
// default; per-user filters (Global / US) come later. The visual gradient is
// light yellow → soft orange → muted red.
//
// Heat scoring is mock-derived in Phase B. Real scoring will come from
// aggregated data once Supabase is wired and we have multiple audits to
// learn from. Until then, these heuristics give the surface something
// honest to render.
// =============================================================================

import type { CalendarVisit } from './mockCalendarData';
import type { MockWorkspaceEntry } from './audit/mockWorkspaceEntries';
import type { MockParticipant } from './mockSiteData';

// 'none' is a valid score that suppresses the indicator entirely. Higher tones
// always include all lower tones' data; the consumer just renders the highest
// they care to surface.
export type HeatScore = 'none' | 'low' | 'moderate' | 'high';

export const HEAT_LABELS: Record<HeatScore, string> = {
  none: 'No common-pattern signal',
  low: 'Low — minor cross-study signal',
  moderate: 'Moderate — common friction across studies',
  high: 'High — frequent cross-study issues',
};

// Tailwind classes for the soft gradient. Tones split into light / dark theme.
// Each tone has: a background tint, a border, and a foreground (for text).
export const HEAT_TONES_LIGHT: Record<HeatScore, string> = {
  none: '',
  low: 'bg-yellow-50 border-yellow-200/80 text-yellow-700',
  moderate: 'bg-orange-50 border-orange-200/80 text-orange-700',
  high: 'bg-red-50 border-red-200/80 text-red-700',
};

export const HEAT_TONES_DARK: Record<HeatScore, string> = {
  none: '',
  low: 'bg-yellow-500/[0.06] border-yellow-500/20 text-yellow-300',
  moderate: 'bg-orange-500/[0.06] border-orange-500/20 text-orange-300',
  high: 'bg-red-500/[0.06] border-red-500/20 text-red-300',
};

// Just-the-color tone — used by inline side markers that don't need the full
// background+border treatment.
export const HEAT_BAR_LIGHT: Record<HeatScore, string> = {
  none: '',
  low: 'bg-yellow-300',
  moderate: 'bg-orange-400',
  high: 'bg-red-500',
};

export const HEAT_BAR_DARK: Record<HeatScore, string> = {
  none: '',
  low: 'bg-yellow-400/70',
  moderate: 'bg-orange-400/70',
  high: 'bg-red-500/70',
};

// =============================================================================
// Scoring — Phase B mock heuristics.
// =============================================================================

// Visits — heat reflects cross-study deviation/missed-window frequency for
// similar visit types. High for time-sensitive dosing/AE windows; moderate
// for early-engagement visits; low for routine follow-ups.
export function scoreVisit(v: CalendarVisit): HeatScore {
  // Active urgency wins regardless of visit type
  if (v.status === 'overdue') return 'high';
  if (v.status === 'closing_soon') return 'high';
  if (v.status === 'deviation') return 'moderate';
  if (v.status === 'missed') return 'moderate';

  const name = v.visitName.toLowerCase();

  // Time-sensitive / regulatory windows
  if (name.includes('dose') || name.includes('infusion')) return 'high';
  if (name.includes('adverse') || name.includes('ae')) return 'high';

  // Early-engagement visits — historically high deviation rate
  if (
    name.includes('screening') ||
    name.includes('baseline') ||
    name.includes('week 2') ||
    name.includes('week 1')
  ) {
    return 'moderate';
  }

  // Routine follow-ups
  return 'low';
}

// Workspace entries — heat reflects how often similar entries become formal
// Findings vs lower-tier classifications across studies. Driven by the
// vendor_domain plus impact level.
export function scoreWorkspaceEntry(e: MockWorkspaceEntry): HeatScore {
  // Severity-driven — Critical/Major almost always flag as findings
  if (e.provisional_impact === 'CRITICAL') return 'high';
  if (e.provisional_impact === 'MAJOR') return 'high';

  const domain = e.vendor_domain.toLowerCase();

  // High-friction domains — change control, validation, audit-trail integrity
  if (
    domain.includes('validation') ||
    domain.includes('audit trail') ||
    domain.includes('change control') ||
    domain.includes('outage') ||
    domain.includes('continuity')
  ) {
    return 'moderate';
  }

  // Lower-friction domains — typically OFIs not findings
  if (
    domain.includes('hygiene') ||
    domain.includes('training') ||
    domain.includes('documentation')
  ) {
    return 'low';
  }

  // Default: minor signal so the indicator still surfaces something
  return 'low';
}

// Participants — heat reflects the cross-study likelihood that this
// participant becomes a deviation/dropout case. Phase B mock heuristics:
// open-deviation count is the strongest signal; status conveys the rest.
export function scoreParticipant(p: MockParticipant): HeatScore {
  // Multiple open deviations on a single participant — common follow-up
  // case across studies.
  if (p.open_deviations >= 2) return 'high';
  if (p.open_deviations === 1) return 'moderate';

  // Withdrawn participants need follow-up regardless of deviation count
  // (consent withdrawal docs, AE follow-up, etc.).
  if (p.status === 'WITHDRAWN') return 'moderate';

  // Screening / screen failure / completed — historically low ongoing risk.
  if (p.status === 'SCREEN_FAILURE') return 'none';
  if (p.status === 'SCREENING' || p.status === 'COMPLETED') return 'low';

  // Active with no deviations — minor signal so the layer is visible
  // without being alarmist.
  return 'low';
}
