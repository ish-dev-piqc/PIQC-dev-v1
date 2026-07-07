// =============================================================================
// Site Mode — shared date utilities.
//
// Pure functions with no side effects. All operate on local calendar dates
// (yyyy-mm-dd strings or Date objects in local time). No timezone conversion.
//
// Previously duplicated between TodayTab.tsx and VisitDetailDrawer.tsx.
// Extracted here so future site surfaces (Subject Command View, reports,
// participant timelines) share one implementation.
// =============================================================================

/** Format a Date as a yyyy-mm-dd string (local time). */
export function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a yyyy-mm-dd string to a Date in local time. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Return a new Date set to midnight of the given date (local time). */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Return a new Date set to midnight of the Sunday on or before the given date. */
export function startOfWeek(d: Date): Date {
  // Week starts on Sunday.
  const copy = startOfDay(d);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

/** Return a new Date set to the first day of the given date's month. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Return a new Date that is `days` days after (or before, if negative) `d`. */
export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Return a new Date that is `months` months after (or before, if negative) `d`. */
export function addMonths(d: Date, months: number): Date {
  // Compute the target year/month first, then clamp the day-of-month to the
  // last valid day of that month. Using Date.setMonth directly on the source
  // day-of-month overflows for days 29–31 (e.g. Jan 31 + 1 → Mar 3, skipping
  // Feb), which corrupts calendar "next/prev month" navigation.
  const targetMonthIndex = d.getMonth() + months;
  const targetYear = d.getFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  // Day 0 of the following month gives the last day of the target month.
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(d.getDate(), daysInTargetMonth);
  const copy = new Date(d);
  copy.setFullYear(targetYear, targetMonth, day);
  return copy;
}

/** True if `a` and `b` fall on the same calendar day (local time). */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** True if `a` and `b` fall in the same calendar month and year. */
export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** True if `d` is before `today` (both compared at start-of-day). */
export function isPast(d: Date, today: Date): boolean {
  return startOfDay(d).getTime() < startOfDay(today).getTime();
}

/** Format a Date as "Wednesday, May 14" (long weekday + month + day, no year). */
export function formatFullDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** Format a Date as "May 2026" (long month + year). */
export function formatMonth(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Cert-expiry helpers (used by TeamTab + dashboard alerts). The `iso` input
 * is an ISO date string — either `yyyy-mm-dd` (no clock) or a full timestamp.
 * For yyyy-mm-dd we anchor at noon local time so DST doesn't bump the date.
 */
function parseCertDate(iso: string): Date {
  return new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
}

/**
 * True when `iso` is empty or does not parse to a real date. An empty/absent
 * `certified_through` (e.g. a NULL coerced to '' by realSiteRepo) must fail
 * CLOSED: a clinical-role member with no cert on file is a compliance gap that
 * should surface as "needs attention", never be indistinguishable from a
 * far-future cert. Without this guard, `NaN` comparisons silently evaluate to
 * "not expired" / "not expiring".
 */
function isMissingCertDate(iso: string): boolean {
  return iso === '' || Number.isNaN(parseCertDate(iso).getTime());
}

export function isCertExpired(iso: string): boolean {
  // Fail closed: a missing/invalid cert date is treated as expired.
  if (isMissingCertDate(iso)) return true;
  return parseCertDate(iso).getTime() < Date.now();
}

export function isCertExpiringSoon(iso: string, windowDays = 30): boolean {
  // A missing/invalid cert date is already surfaced as expired (fail closed),
  // so it is not additionally "expiring soon" — callers render the two states
  // as mutually exclusive.
  if (isMissingCertDate(iso)) return false;
  const t = parseCertDate(iso).getTime();
  const now = Date.now();
  return t > now && t < now + windowDays * 24 * 60 * 60 * 1000;
}

export function daysUntilCertExpiry(iso: string): number {
  // Missing/invalid cert date sorts as maximally overdue.
  if (isMissingCertDate(iso)) return -Infinity;
  const diffMs = parseCertDate(iso).getTime() - Date.now();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Format a 7-day week range starting at `start` as a human-readable string,
 * e.g. "May 10 – 16, 2026" or "Dec 28, 2025 – Jan 3, 2026".
 */
export function formatWeekRange(start: Date): string {
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = sameMonth
    ? end.toLocaleDateString('en-US', { day: 'numeric' })
    : end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const yearStr = sameYear ? start.getFullYear() : `${start.getFullYear()} – ${end.getFullYear()}`;
  return `${startStr} – ${endStr}, ${yearStr}`;
}
