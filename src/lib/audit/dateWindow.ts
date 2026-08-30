// =============================================================================
// Audit scheduled-window formatting.
//
// One home for rendering audits.scheduled_date / scheduled_end_date so every
// surface (workspace header, hub worklist, Stage-8 export, ISA report meta)
// says the same thing. Audit-owned on purpose — lib/site has adjacent helpers
// (formatWeekRange), but importing across modes is off-limits.
// =============================================================================

// Anchor date-only strings to LOCAL midnight. A bare yyyy-mm-dd parses as UTC
// midnight per ECMA-262, which renders the previous calendar day in any
// UTC-negative zone — the auditor would see a scheduled date they never entered.
function atLocalMidnight(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

const MDY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

/** "2026-09-15" → "Sep 15, 2026". Null in, null out. */
export function formatAuditDate(iso: string | null): string | null {
  if (!iso) return null;
  return atLocalMidnight(iso).toLocaleDateString('en-US', MDY);
}

/**
 * Render the scheduled window as one human string, collapsing shared
 * month/year: "Sep 15 – 17, 2026", "Sep 28 – Oct 2, 2026",
 * "Dec 30, 2026 – Jan 2, 2027". No end date (or end = start) → the single
 * date; no start date → null (unscheduled).
 */
export function formatAuditWindow(start: string | null, end: string | null): string | null {
  if (!start) return null;
  if (!end || end === start) return formatAuditDate(start);

  const s = atLocalMidnight(start);
  const e = atLocalMidnight(end);
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();

  if (sameMonth) {
    const month = s.toLocaleDateString('en-US', { month: 'short' });
    return `${month} ${s.getDate()} – ${e.getDate()}, ${s.getFullYear()}`;
  }
  if (sameYear) {
    const sMd = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const eMd = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${sMd} – ${eMd}, ${s.getFullYear()}`;
  }
  return `${s.toLocaleDateString('en-US', MDY)} – ${e.toLocaleDateString('en-US', MDY)}`;
}
