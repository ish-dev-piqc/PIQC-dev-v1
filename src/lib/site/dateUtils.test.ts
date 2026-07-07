import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import {
  formatYmd,
  parseYmd,
  startOfDay,
  startOfWeek,
  startOfMonth,
  addDays,
  addMonths,
  isSameDay,
  isSameMonth,
  isPast,
  formatFullDate,
  formatMonth,
  formatWeekRange,
  isCertExpired,
  isCertExpiringSoon,
  daysUntilCertExpiry,
} from './dateUtils';

// =============================================================================
// dateUtils — behavior-locking tests.
//
// Locks the exact behavior that was inlined in TodayTab.tsx and
// VisitDetailDrawer.tsx before extraction. Any change to a function that
// causes a test here to fail means the extraction altered behavior.
// =============================================================================

describe('parseYmd', () => {
  it('parses a standard date string', () => {
    const d = parseYmd('2026-05-14');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // May = 4
    expect(d.getDate()).toBe(14);
  });

  it('parses month boundary correctly (month is 0-indexed)', () => {
    const d = parseYmd('2026-01-01');
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });

  it('parses end-of-year', () => {
    const d = parseYmd('2026-12-31');
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });
});

describe('formatYmd', () => {
  it('formats a date as yyyy-mm-dd', () => {
    expect(formatYmd(new Date(2026, 4, 14))).toBe('2026-05-14');
  });

  it('zero-pads single-digit month and day', () => {
    expect(formatYmd(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('round-trips with parseYmd', () => {
    expect(formatYmd(parseYmd('2026-05-10'))).toBe('2026-05-10');
    expect(formatYmd(parseYmd('2026-12-31'))).toBe('2026-12-31');
    expect(formatYmd(parseYmd('2026-01-01'))).toBe('2026-01-01');
  });
});

describe('startOfDay', () => {
  it('zeroes time components but preserves date', () => {
    const d = new Date(2026, 4, 14, 15, 30, 45, 999);
    const s = startOfDay(d);
    expect(s.getHours()).toBe(0);
    expect(s.getMinutes()).toBe(0);
    expect(s.getSeconds()).toBe(0);
    expect(s.getMilliseconds()).toBe(0);
    expect(s.getFullYear()).toBe(2026);
    expect(s.getMonth()).toBe(4);
    expect(s.getDate()).toBe(14);
  });

  it('returns a new Date (does not mutate input)', () => {
    const d = new Date(2026, 4, 14, 23, 59, 59);
    const before = d.getTime();
    startOfDay(d);
    expect(d.getTime()).toBe(before);
  });
});

describe('startOfWeek', () => {
  it('returns the Sunday on or before the given date', () => {
    // Wed May 13, 2026
    const wed = new Date(2026, 4, 13);
    const sun = startOfWeek(wed);
    expect(sun.getDay()).toBe(0);
    expect(sun.getDate()).toBe(10); // Sun May 10
  });

  it('returns the same day when given a Sunday', () => {
    const sun = new Date(2026, 4, 10);
    const result = startOfWeek(sun);
    expect(result.getDate()).toBe(10);
  });

  it('handles a Saturday (6 days from Sunday)', () => {
    // Sat May 16, 2026
    const sat = new Date(2026, 4, 16);
    const sun = startOfWeek(sat);
    expect(sun.getDate()).toBe(10);
  });

  it('crosses month boundaries', () => {
    // Wed Apr 1, 2026
    const wed = new Date(2026, 3, 1);
    const sun = startOfWeek(wed);
    expect(sun.getMonth()).toBe(2); // March
    expect(sun.getDate()).toBe(29);
  });
});

describe('startOfMonth', () => {
  it('returns the first day of the month', () => {
    const d = startOfMonth(new Date(2026, 4, 14));
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(4);
    expect(d.getFullYear()).toBe(2026);
  });
});

describe('addDays', () => {
  it('adds positive days', () => {
    const d = addDays(new Date(2026, 4, 10), 5);
    expect(d.getDate()).toBe(15);
  });

  it('subtracts on negative input', () => {
    const d = addDays(new Date(2026, 4, 10), -3);
    expect(d.getDate()).toBe(7);
  });

  it('crosses month boundaries', () => {
    const d = addDays(new Date(2026, 4, 30), 5);
    expect(d.getMonth()).toBe(5); // June
    expect(d.getDate()).toBe(4);
  });

  it('does not mutate the input', () => {
    const original = new Date(2026, 4, 10);
    addDays(original, 5);
    expect(original.getDate()).toBe(10);
  });
});

describe('addMonths', () => {
  it('adds positive months', () => {
    const d = addMonths(new Date(2026, 4, 14), 3);
    expect(d.getMonth()).toBe(7); // August
  });

  it('subtracts on negative input', () => {
    const d = addMonths(new Date(2026, 4, 14), -2);
    expect(d.getMonth()).toBe(2); // March
  });

  it('crosses year boundaries', () => {
    const d = addMonths(new Date(2026, 10, 1), 3);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(1); // February
  });

  // SIT-201: from a day-of-month that doesn't exist in the target month, clamp
  // to the last valid day instead of overflowing into the following month.
  it('clamps Jan 31 + 1 month to the last day of Feb (not March)', () => {
    const d = addMonths(new Date(2026, 0, 31), 1); // 2026 is not a leap year
    expect(d.getMonth()).toBe(1); // February, not March
    expect(d.getDate()).toBe(28); // Feb 2026 has 28 days
  });

  it('clamps into a leap-year February (Feb 29)', () => {
    const d = addMonths(new Date(2028, 0, 31), 1); // 2028 is a leap year
    expect(d.getMonth()).toBe(1); // February
    expect(d.getDate()).toBe(29); // Feb 2028 has 29 days
  });

  it('clamps a negative delta the same way (Mar 31 − 1 month → Feb)', () => {
    const d = addMonths(new Date(2026, 2, 31), -1);
    expect(d.getMonth()).toBe(1); // February
    expect(d.getDate()).toBe(28);
  });

  it('does not clamp when the target day exists (May 31 + 2 months → Jul 31)', () => {
    const d = addMonths(new Date(2026, 4, 31), 2);
    expect(d.getMonth()).toBe(6); // July
    expect(d.getDate()).toBe(31);
  });

  it('does not mutate the input', () => {
    const original = new Date(2026, 0, 31);
    addMonths(original, 1);
    expect(original.getMonth()).toBe(0);
    expect(original.getDate()).toBe(31);
  });
});

describe('isSameDay', () => {
  it('returns true for the same date with different times', () => {
    const a = new Date(2026, 4, 14, 9, 0);
    const b = new Date(2026, 4, 14, 22, 30);
    expect(isSameDay(a, b)).toBe(true);
  });

  it('returns false for adjacent days', () => {
    const a = new Date(2026, 4, 14);
    const b = new Date(2026, 4, 15);
    expect(isSameDay(a, b)).toBe(false);
  });

  it('returns false for same day in different years', () => {
    const a = new Date(2026, 4, 14);
    const b = new Date(2025, 4, 14);
    expect(isSameDay(a, b)).toBe(false);
  });
});

describe('isSameMonth', () => {
  it('returns true for different days in the same month', () => {
    expect(isSameMonth(new Date(2026, 4, 1), new Date(2026, 4, 31))).toBe(true);
  });

  it('returns false for the same day in different months', () => {
    expect(isSameMonth(new Date(2026, 4, 14), new Date(2026, 5, 14))).toBe(false);
  });

  it('returns false for the same month in different years', () => {
    expect(isSameMonth(new Date(2026, 4, 14), new Date(2025, 4, 14))).toBe(false);
  });
});

describe('isPast', () => {
  it('returns true when d is before today', () => {
    const today = new Date(2026, 4, 14);
    const yesterday = new Date(2026, 4, 13);
    expect(isPast(yesterday, today)).toBe(true);
  });

  it('returns false when d is today', () => {
    const today = new Date(2026, 4, 14, 9, 0);
    const sameDayLater = new Date(2026, 4, 14, 18, 30);
    expect(isPast(sameDayLater, today)).toBe(false);
  });

  it('returns false when d is in the future', () => {
    const today = new Date(2026, 4, 14);
    const tomorrow = new Date(2026, 4, 15);
    expect(isPast(tomorrow, today)).toBe(false);
  });
});

describe('formatFullDate', () => {
  it('renders weekday + long month + day', () => {
    // Thu May 14, 2026
    expect(formatFullDate(new Date(2026, 4, 14))).toBe('Thursday, May 14');
  });
});

describe('formatMonth', () => {
  it('renders long month and year', () => {
    expect(formatMonth(new Date(2026, 4, 14))).toBe('May 2026');
  });
});

describe('cert-expiry helpers', () => {
  // Lock Date.now so the tests are deterministic regardless of when they run.
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00').getTime());
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('isCertExpired is true for a past date', () => {
    expect(isCertExpired('2026-05-18')).toBe(true);
  });

  it('isCertExpired is false for a future date', () => {
    expect(isCertExpired('2026-06-01')).toBe(false);
  });

  it('isCertExpiringSoon is true within the 30-day window', () => {
    expect(isCertExpiringSoon('2026-05-25')).toBe(true);
    expect(isCertExpiringSoon('2026-06-15')).toBe(true);
  });

  it('isCertExpiringSoon is false outside the 30-day window', () => {
    expect(isCertExpiringSoon('2026-07-01')).toBe(false);
  });

  it('isCertExpiringSoon is false for already-expired dates', () => {
    expect(isCertExpiringSoon('2026-05-18')).toBe(false);
  });

  it('daysUntilCertExpiry returns days remaining (rounded up)', () => {
    expect(daysUntilCertExpiry('2026-05-29')).toBe(10);
  });

  it('daysUntilCertExpiry is negative for past dates', () => {
    expect(daysUntilCertExpiry('2026-05-09')).toBeLessThan(0);
  });

  // SIT-202: an empty/absent certified_through must fail CLOSED — treated as
  // expired / needs attention, never silently "not expired".
  it('isCertExpired is true for an empty cert date (fail closed)', () => {
    expect(isCertExpired('')).toBe(true);
  });

  it('isCertExpired is true for an unparseable cert date (fail closed)', () => {
    expect(isCertExpired('not-a-date')).toBe(true);
  });

  it('isCertExpiringSoon is false for an empty cert date (already expired)', () => {
    expect(isCertExpiringSoon('')).toBe(false);
  });

  it('isCertExpiringSoon is false for an unparseable cert date', () => {
    expect(isCertExpiringSoon('not-a-date')).toBe(false);
  });

  it('daysUntilCertExpiry sorts an empty cert date as maximally overdue', () => {
    expect(daysUntilCertExpiry('')).toBe(-Infinity);
  });
});

describe('formatWeekRange', () => {
  it('renders a same-month range', () => {
    // Sun May 10 → Sat May 16, 2026
    expect(formatWeekRange(new Date(2026, 4, 10))).toBe('May 10 – 16, 2026');
  });

  it('renders a cross-month range', () => {
    // Sun May 31 → Sat Jun 6, 2026
    expect(formatWeekRange(new Date(2026, 4, 31))).toBe('May 31 – Jun 6, 2026');
  });

  it('renders a cross-year range', () => {
    // Sun Dec 28, 2025 → Sat Jan 3, 2026
    expect(formatWeekRange(new Date(2025, 11, 28))).toBe('Dec 28 – Jan 3, 2025 – 2026');
  });
});
