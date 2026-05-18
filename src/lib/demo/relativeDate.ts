// =============================================================================
// Relative-date helpers — fixtures use offsets from "today" so the calendar
// always looks current. e.g. addDays(-3) → date 3 days before today (yyyy-mm-dd).
// =============================================================================

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(offsetDays: number, base: Date = new Date()): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  return ymd(d);
}

// ISO datetime for visit windows. Default close time is 5pm local.
export function addDaysIso(offsetDays: number, hour = 17, base: Date = new Date()): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
