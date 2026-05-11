// =============================================================================
// Backup demo dataset for Site Mode's calendar.
//
// The MOCK_VISITS array is kept as the runtime source for the calendar's
// "Demo data" toggle (TodayTab, VisitsTab, ReportsTab). When the toggle is
// off, the wired components read from Supabase instead.
//
// Color palette and helpers have moved to src/lib/site/protocolColors.ts.
// Type definitions stay here for back-compat with still-mock consumers
// (VisitDetailDrawer, etc.); they will move to src/lib/site/types.ts later.
// =============================================================================

// Re-export from the new home so legacy imports keep working.
export {
  PROTOCOL_COLORS,
  getProtocolColors,
  getProtocolColorsById,
  type ProtocolColors,
} from './site/protocolColors';

export type VisitStatus =
  | 'scheduled' // future or today, not yet done
  | 'completed' // past, done cleanly
  | 'missed' // past, window closed without visit
  | 'deviation' // past, done but with protocol deviation logged
  | 'overdue' // past scheduled date, window still open
  | 'closing_soon'; // today / near-term, window closing in <24h

// One additional mention of a visit found elsewhere in the protocol's
// documents — populated by the ingest pipeline (Phase B). Optional so
// existing mock data continues to satisfy the type.
export interface CalendarVisitCrossReference {
  source_section: string;       // e.g. "7.4 Safety monitoring"
  snippet: string;              // verbatim passage that adds context
  page?: number;                // page number if known
  document_id?: string;
  document_title?: string;
}

export interface CalendarVisit {
  id: string;
  date: string; // yyyy-mm-dd
  time?: string; // "9:00 AM" — optional; visit is a day-event if omitted
  protocolId: string;
  participantId: string; // e.g. "P-0023"
  studyDay: number; // day number in the participant's study timeline
  visitName: string; // e.g. "Week 2 follow-up"
  windowCloses?: string; // iso datetime when visit window closes
  status: VisitStatus;
  procedures?: string[]; // planned procedures / activities
  priorNote?: string; // brief context from prior visit
  deviationReason?: string; // populated when status = 'deviation'
  crossReferences?: CalendarVisitCrossReference[]; // Phase B — joined from template
}

// Participants grouped by protocol — used by the Demo-data toggle path.
export const PROTOCOL_PARTICIPANTS: Record<string, string[]> = {
  'proto-001': ['P-0019', 'P-0023', 'P-0045', 'P-0051'],
  'proto-002': ['P-0008', 'P-0012'],
  'proto-003': ['P-0031'],
};

// ~16 visits spanning 2 weeks centered on 2026-04-22.
export const MOCK_VISITS: CalendarVisit[] = [
  // --- PAST WEEK ---
  {
    id: 'v-001',
    date: '2026-04-13',
    time: '9:00 AM',
    protocolId: 'proto-001',
    participantId: 'P-0045',
    studyDay: 28,
    visitName: 'Week 4 follow-up',
    status: 'completed',
    procedures: ['Vitals', 'PK blood draw', 'AE check', 'Concomitant meds review'],
    priorNote: 'Previous visit completed on schedule. No AEs reported.',
  },
  {
    id: 'v-002',
    date: '2026-04-14',
    time: '10:30 AM',
    protocolId: 'proto-001',
    participantId: 'P-0023',
    studyDay: 1,
    visitName: 'Screening visit',
    status: 'completed',
    procedures: ['Informed consent', 'Eligibility review', 'Medical history', 'Labs'],
    priorNote: 'New enrollment.',
  },
  {
    id: 'v-003',
    date: '2026-04-15',
    time: '2:00 PM',
    protocolId: 'proto-002',
    participantId: 'P-0012',
    studyDay: 7,
    visitName: 'Day 7 visit',
    status: 'deviation',
    procedures: ['ECG', 'Vitals', 'Drug dispensation'],
    priorNote: 'Participant arrived 4 hours outside visit window.',
    deviationReason: 'Visit conducted outside protocol-defined window (+/- 2 days). PI notified, deviation logged.',
  },
  {
    id: 'v-004',
    date: '2026-04-16',
    time: '11:00 AM',
    protocolId: 'proto-001',
    participantId: 'P-0019',
    studyDay: 14,
    visitName: 'Week 2 visit',
    status: 'missed',
    procedures: ['Vitals', 'AE check', 'Labs'],
    priorNote: 'Participant did not show. Two contact attempts made.',
  },
  {
    id: 'v-005',
    date: '2026-04-17',
    time: '9:30 AM',
    protocolId: 'proto-003',
    participantId: 'P-0031',
    studyDay: 1,
    visitName: 'Dose 1 administration',
    status: 'completed',
    procedures: ['Pre-dose vitals', 'IV infusion (60 min)', 'Post-dose observation (2h)'],
    priorNote: 'Screening completed 2 weeks prior. Eligibility confirmed.',
  },

  // --- THIS WEEK, PAST ---
  {
    id: 'v-006',
    date: '2026-04-20',
    time: '8:30 AM',
    protocolId: 'proto-002',
    participantId: 'P-0008',
    studyDay: 1,
    visitName: 'Screening visit',
    status: 'completed',
    procedures: ['Informed consent', 'Eligibility review', 'Baseline labs', 'ECG'],
    priorNote: 'Referred by cardiology. Consented without issue.',
  },
  {
    id: 'v-007',
    date: '2026-04-20',
    time: '1:00 PM',
    protocolId: 'proto-001',
    participantId: 'P-0051',
    studyDay: 14,
    visitName: 'Week 2 visit',
    windowCloses: '2026-04-24T17:00:00',
    status: 'overdue',
    procedures: ['Vitals', 'AE check', 'Blood draw'],
    priorNote: 'Participant rescheduled from original date. Window still open.',
  },
  {
    id: 'v-008',
    date: '2026-04-21',
    time: '10:00 AM',
    protocolId: 'proto-001',
    participantId: 'P-0045',
    studyDay: 35,
    visitName: 'Week 5 check-in',
    status: 'completed',
    procedures: ['Vitals', 'AE check'],
    priorNote: 'No changes since last visit.',
  },

  // --- TODAY (2026-04-22) ---
  {
    id: 'v-009',
    date: '2026-04-22',
    time: '9:00 AM',
    protocolId: 'proto-001',
    participantId: 'P-0023',
    studyDay: 4,
    visitName: 'Day 4 baseline',
    status: 'scheduled',
    procedures: ['Vitals', 'Baseline labs', 'Pre-treatment ECG', 'PRO questionnaires'],
    priorNote: 'Screening completed Apr 14. Participant confirmed attendance.',
  },
  {
    id: 'v-010',
    date: '2026-04-22',
    time: '11:30 AM',
    protocolId: 'proto-002',
    participantId: 'P-0012',
    studyDay: 14,
    visitName: 'Day 14 visit',
    windowCloses: '2026-04-22T17:00:00',
    status: 'closing_soon',
    procedures: ['ECG', 'Vitals', 'Drug dispensation', 'AE check'],
    priorNote: 'Previous visit had window deviation. Please confirm arrival on time.',
  },
  {
    id: 'v-011',
    date: '2026-04-22',
    time: '2:00 PM',
    protocolId: 'proto-003',
    participantId: 'P-0031',
    studyDay: 15,
    visitName: 'Dose 2 administration',
    status: 'scheduled',
    procedures: ['Pre-dose vitals', 'IV infusion (60 min)', 'Post-dose observation (2h)'],
    priorNote: 'Dose 1 tolerated well. No AEs.',
  },

  // --- UPCOMING ---
  {
    id: 'v-012',
    date: '2026-04-23',
    time: '9:30 AM',
    protocolId: 'proto-001',
    participantId: 'P-0019',
    studyDay: 21,
    visitName: 'Week 3 follow-up',
    status: 'scheduled',
    procedures: ['Vitals', 'AE check', 'Labs'],
    priorNote: 'Previous Week 2 visit was missed. Reschedule confirmed.',
  },
  {
    id: 'v-013',
    date: '2026-04-23',
    time: '2:30 PM',
    protocolId: 'proto-002',
    participantId: 'P-0008',
    studyDay: 4,
    visitName: 'Day 4 baseline',
    status: 'scheduled',
    procedures: ['Vitals', 'Baseline ECG', 'Labs', 'Study drug dispensation'],
    priorNote: 'Screening completed Apr 20.',
  },
  {
    id: 'v-014',
    date: '2026-04-24',
    time: '10:00 AM',
    protocolId: 'proto-001',
    participantId: 'P-0045',
    studyDay: 42,
    visitName: 'Week 6 visit',
    status: 'scheduled',
    procedures: ['Vitals', 'Labs', 'AE check', 'PRO questionnaires'],
    priorNote: 'Maintenance visit. On schedule.',
  },
  {
    id: 'v-015',
    date: '2026-04-24',
    time: '1:30 PM',
    protocolId: 'proto-003',
    participantId: 'P-0031',
    studyDay: 17,
    visitName: 'Post-dose follow-up',
    status: 'scheduled',
    procedures: ['Vitals', 'AE check', 'Blood draw'],
    priorNote: 'Safety follow-up after Dose 2.',
  },
  {
    id: 'v-016',
    date: '2026-04-27',
    time: '9:00 AM',
    protocolId: 'proto-001',
    participantId: 'P-0023',
    studyDay: 9,
    visitName: 'Week 1 visit',
    status: 'scheduled',
    procedures: ['Vitals', 'AE check', 'Labs', 'Study drug dispensation'],
    priorNote: 'First post-baseline visit.',
  },
];
