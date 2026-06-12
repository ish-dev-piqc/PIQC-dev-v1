import { describe, expect, it } from 'vitest';
import { buildVisitIcs, buildVisitIcsBlob } from '../calendarExport';
import type { SiteVisit } from '../types';

// =============================================================================
// calendarExport — verify VCALENDAR envelope, VEVENT shape, all-day vs
// timed split, status mapping, escaping, and stable UID.
// =============================================================================

const visit = (over: Partial<SiteVisit> = {}): SiteVisit => ({
  id: over.id ?? 'v-1',
  date: over.date ?? '2026-06-04',
  protocolId: over.protocolId ?? 'p-1',
  participantId: over.participantId ?? 'P-0001',
  studyDay: over.studyDay ?? 5,
  visitName: over.visitName ?? 'Week 1',
  status: over.status ?? 'scheduled',
  ...over,
});

const codes = new Map([['p-1', 'PP06489']]);

describe('buildVisitIcs envelope', () => {
  it('wraps with BEGIN:VCALENDAR / END:VCALENDAR', () => {
    const ics = buildVisitIcs({ visits: [visit()], protocolCodeById: codes });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('includes X-WR-CALNAME when calendarName is set', () => {
    const ics = buildVisitIcs({
      visits: [],
      protocolCodeById: codes,
      calendarName: 'PP06489 schedule',
    });
    expect(ics).toContain('X-WR-CALNAME:PP06489 schedule');
  });
});

describe('buildVisitIcs VEVENT', () => {
  it('emits one VEVENT per visit', () => {
    const ics = buildVisitIcs({
      visits: [visit({ id: 'a' }), visit({ id: 'b' })],
      protocolCodeById: codes,
    });
    const events = ics.match(/BEGIN:VEVENT/g) ?? [];
    expect(events).toHaveLength(2);
  });

  it('uses a stable UID format keyed by visit id', () => {
    const ics = buildVisitIcs({
      visits: [visit({ id: 'abc-123' })],
      protocolCodeById: codes,
    });
    expect(ics).toContain('UID:piqc-visit-abc-123@piqclinical.com');
  });

  it('emits all-day events when time is absent', () => {
    const ics = buildVisitIcs({ visits: [visit()], protocolCodeById: codes });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260604');
    expect(ics).toContain('DTEND;VALUE=DATE:20260605');
  });

  it('emits timed events when time is present (24h)', () => {
    const ics = buildVisitIcs({
      visits: [visit({ time: '14:30' })],
      protocolCodeById: codes,
    });
    expect(ics).toContain('DTSTART:20260604T143000');
    expect(ics).toContain('DTEND:20260604T153000');
  });

  it('parses 12h AM/PM time', () => {
    const ics = buildVisitIcs({
      visits: [visit({ time: '9:00 AM' })],
      protocolCodeById: codes,
    });
    expect(ics).toContain('DTSTART:20260604T090000');
    expect(ics).toContain('DTEND:20260604T100000');
  });

  it('wraps midnight when timed event crosses end-of-day', () => {
    const ics = buildVisitIcs({
      visits: [visit({ time: '23:30' })],
      protocolCodeById: codes,
    });
    expect(ics).toContain('DTSTART:20260604T233000');
    expect(ics).toContain('DTEND:20260605T003000');
  });

  it('maps completed to CONFIRMED and missed to CANCELLED', () => {
    const ics1 = buildVisitIcs({
      visits: [visit({ id: 'a', status: 'completed' })],
      protocolCodeById: codes,
    });
    expect(ics1).toContain('STATUS:CONFIRMED');
    const ics2 = buildVisitIcs({
      visits: [visit({ id: 'b', status: 'missed' })],
      protocolCodeById: codes,
    });
    expect(ics2).toContain('STATUS:CANCELLED');
  });

  it('omits STATUS for scheduled', () => {
    const ics = buildVisitIcs({
      visits: [visit({ status: 'scheduled' })],
      protocolCodeById: codes,
    });
    expect(ics).not.toContain('STATUS:');
  });

  it('escapes commas, semicolons, and newlines in DESCRIPTION', () => {
    const ics = buildVisitIcs({
      visits: [
        visit({
          priorNote: 'Bring sample; ID required, please.',
          deviationReason: 'Late draw\nfollow-up tomorrow',
        }),
      ],
      protocolCodeById: codes,
    });
    // RFC 5545 line folding may insert "\r\n " every 75 chars including
    // mid-escape — calendar parsers unfold before reading values, so we
    // unfold here too before checking the escaped substring.
    const unfolded = ics.replace(/\r\n /g, '');
    // ICS escapes: , → \,   ; → \;   newline → \n
    expect(unfolded).toContain('Note: Bring sample\\; ID required\\, please.');
    expect(unfolded).toContain('Deviation: Late draw\\nfollow-up tomorrow');
  });

  it('falls back to all-day when time cannot be parsed', () => {
    const ics = buildVisitIcs({
      visits: [visit({ time: 'sometime in the morning' })],
      protocolCodeById: codes,
    });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260604');
  });

  it('includes protocol code in DESCRIPTION when available', () => {
    const ics = buildVisitIcs({ visits: [visit()], protocolCodeById: codes });
    expect(ics).toContain('Protocol: PP06489');
  });
});

describe('buildVisitIcsBlob', () => {
  it('returns a text/calendar Blob', () => {
    const blob = buildVisitIcsBlob({ visits: [visit()], protocolCodeById: codes });
    expect(blob.type).toBe('text/calendar;charset=utf-8');
    expect(blob.size).toBeGreaterThan(0);
  });
});
