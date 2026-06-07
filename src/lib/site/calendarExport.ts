import type { SiteVisit } from './types';

// =============================================================================
// calendarExport — pure RFC-5545 .ics builder for site visit schedules.
//
// No external library: the format is line-oriented text. The helper
// handles:
//   - Header / footer envelope
//   - All-day vs timed event split
//   - DESCRIPTION composition + escaping (commas, semicolons, newlines)
//   - 75-octet line folding per RFC 5545 §3.1
//
// Stable UIDs (`piqc-visit-<id>@piqclinical.com`) so re-importing the same
// file updates existing events instead of creating duplicates.
// =============================================================================

export interface BuildVisitIcsInput {
  visits: SiteVisit[];
  /** id → code lookup (e.g. "PP06489"). Used inside the VEVENT description
   *  and the SUMMARY. Empty string fallback when an id isn't in the map. */
  protocolCodeById: Map<string, string>;
  /** Top-level X-WR-CALNAME — appears as the calendar name in most apps. */
  calendarName?: string;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** RFC 5545 §3.3.11 — escape `\`, `,`, `;`, newline in TEXT values. */
function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** RFC 5545 §3.1 — fold lines longer than 75 octets onto continuation
 *  lines starting with a single space. Simple char-count fold; sufficient
 *  for ASCII payloads (UIDs, codes, dates) and short multilingual text. */
function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let remaining = line;
  while (remaining.length > 75) {
    out.push(remaining.slice(0, 75));
    remaining = remaining.slice(75);
  }
  out.push(remaining);
  return out.join('\r\n ');
}

function joinLines(lines: string[]): string {
  return lines.map(foldIcsLine).join('\r\n');
}

// "2026-06-04" → "20260604"
function ymdToIcs(date: string): string {
  return date.replace(/-/g, '');
}

// "9:00 AM" / "14:30" → "HHmmss" (24h). Returns null when the time can't
// be parsed; caller falls back to all-day.
function parseIcsTime(time: string): string | null {
  const t = time.trim();
  // 24h "HH:mm" or "HH:mm:ss"
  let m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const h = String(Number(m[1])).padStart(2, '0');
    const mm = m[2];
    const ss = (m[3] ?? '00').padStart(2, '0');
    if (Number(h) > 23 || Number(mm) > 59) return null;
    return `${h}${mm}${ss}`;
  }
  // 12h "h:mm AM/PM"
  m = t.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === 'pm') h += 12;
    const mm = m[2];
    if (h > 23 || Number(mm) > 59) return null;
    return `${String(h).padStart(2, '0')}${mm}00`;
  }
  return null;
}

// "yyyymmdd" → next day's "yyyymmdd". For all-day DTEND.
function ymdPlusOneDay(yyyymmdd: string): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// "HHmmss" + 1 hour, with wrap to next day if necessary. Returns
// `{ time, addedDays }`.
function timePlusHour(hhmmss: string): { time: string; addedDays: number } {
  const h = Number(hhmmss.slice(0, 2));
  const m = hhmmss.slice(2, 4);
  const s = hhmmss.slice(4, 6);
  const next = h + 1;
  if (next < 24) {
    return { time: `${String(next).padStart(2, '0')}${m}${s}`, addedDays: 0 };
  }
  return { time: `${String(next - 24).padStart(2, '0')}${m}${s}`, addedDays: 1 };
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

function icsStatusFor(visitStatus: SiteVisit['status']): string | null {
  switch (visitStatus) {
    case 'completed':
      return 'CONFIRMED';
    case 'missed':
      return 'CANCELLED';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public — build the .ics text
// ---------------------------------------------------------------------------

export function buildVisitIcs({
  visits,
  protocolCodeById,
  calendarName,
}: BuildVisitIcsInput): string {
  const now = new Date();
  const dtstamp = [
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    'T',
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
    'Z',
  ].join('');

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PIQ Clinical//PIQC v1//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (calendarName) lines.push(`X-WR-CALNAME:${escapeIcsText(calendarName)}`);

  for (const v of visits) {
    const code = protocolCodeById.get(v.protocolId) ?? '';
    const startDate = ymdToIcs(v.date);
    const summary = escapeIcsText(`${v.visitName} · ${v.participantId}`);
    const status = icsStatusFor(v.status);

    const descLines: string[] = [];
    if (code) descLines.push(`Protocol: ${code}`);
    descLines.push(`Participant: ${v.participantId}`);
    descLines.push(`Study day: ${v.studyDay}`);
    descLines.push(`Status: ${v.status}`);
    if (v.procedures && v.procedures.length > 0) {
      descLines.push(`Procedures: ${v.procedures.join(', ')}`);
    }
    if (v.priorNote) descLines.push(`Note: ${v.priorNote}`);
    if (v.deviationReason) descLines.push(`Deviation: ${v.deviationReason}`);
    const description = escapeIcsText(descLines.join('\n'));

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:piqc-visit-${v.id}@piqclinical.com`);
    lines.push(`DTSTAMP:${dtstamp}`);

    const startTime = v.time ? parseIcsTime(v.time) : null;
    if (startTime) {
      // Timed — floating local time, no TZID. Most calendar apps handle
      // floating as "the user's local time", which matches how site
      // coordinators read the visit `time` field today.
      const { time: endTime, addedDays } = timePlusHour(startTime);
      const endDate = addedDays > 0 ? ymdPlusOneDay(startDate) : startDate;
      lines.push(`DTSTART:${startDate}T${startTime}`);
      lines.push(`DTEND:${endDate}T${endTime}`);
    } else {
      // All-day. DTEND;VALUE=DATE is exclusive (the day after).
      lines.push(`DTSTART;VALUE=DATE:${startDate}`);
      lines.push(`DTEND;VALUE=DATE:${ymdPlusOneDay(startDate)}`);
    }

    lines.push(`SUMMARY:${summary}`);
    if (description) lines.push(`DESCRIPTION:${description}`);
    if (status) lines.push(`STATUS:${status}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  // Trailing CRLF — required by some strict parsers.
  return joinLines(lines) + '\r\n';
}

/** Convenience — wrap the built string in a Blob ready for download. */
export function buildVisitIcsBlob(input: BuildVisitIcsInput): Blob {
  return new Blob([buildVisitIcs(input)], { type: 'text/calendar;charset=utf-8' });
}
