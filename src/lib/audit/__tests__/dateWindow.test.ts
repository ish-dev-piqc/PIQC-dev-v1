import { describe, it, expect } from 'vitest';
import { formatAuditDate, formatAuditWindow } from '../dateWindow';

describe('formatAuditDate', () => {
  it('formats a yyyy-mm-dd string', () => {
    expect(formatAuditDate('2026-09-15')).toBe('Sep 15, 2026');
  });

  it('returns null for null', () => {
    expect(formatAuditDate(null)).toBe(null);
  });

  // The local-midnight anchor: a bare yyyy-mm-dd parses as UTC midnight and
  // renders the previous day in UTC-negative zones. The anchored render must
  // show the entered calendar day in every timezone the suite runs in.
  it('renders the entered calendar day (local anchor, not UTC)', () => {
    expect(formatAuditDate('2026-01-01')).toBe('Jan 1, 2026');
  });
});

describe('formatAuditWindow', () => {
  it('is null when unscheduled', () => {
    expect(formatAuditWindow(null, null)).toBe(null);
  });

  it('single day when end is absent', () => {
    expect(formatAuditWindow('2026-09-15', null)).toBe('Sep 15, 2026');
  });

  it('single day when end equals start', () => {
    expect(formatAuditWindow('2026-09-15', '2026-09-15')).toBe('Sep 15, 2026');
  });

  it('collapses a same-month window', () => {
    expect(formatAuditWindow('2026-09-15', '2026-09-17')).toBe('Sep 15 – 17, 2026');
  });

  it('collapses a same-year cross-month window', () => {
    expect(formatAuditWindow('2026-09-28', '2026-10-02')).toBe('Sep 28 – Oct 2, 2026');
  });

  it('spells out a cross-year window', () => {
    expect(formatAuditWindow('2026-12-30', '2027-01-02')).toBe('Dec 30, 2026 – Jan 2, 2027');
  });
});
