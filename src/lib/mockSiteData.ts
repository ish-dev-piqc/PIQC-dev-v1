// =============================================================================
// Site Mode — backup mock dataset (kept by intent).
//
// Runtime data flows through SiteDataContext → siteApi → Supabase. This file
// stays as a frozen reference dataset:
//   - Type definitions and label maps used by both wired and toggle paths.
//   - MOCK_PARTICIPANTS array — currently dormant; kept as a backup so the
//     "Demo data" toggle path can be extended to participants in the future
//     and so future seed scripts can read from it.
//   - MOCK_TEAM has been removed (Team tab is fully Supabase-backed).
//
// Sponsor-name-free by rule.
// =============================================================================

export type ParticipantStatus =
  | 'SCREENING'
  | 'SCREEN_FAILURE'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'WITHDRAWN';

export interface MockParticipant {
  id: string;                       // e.g. "P-0023"
  protocol_id: string;
  status: ParticipantStatus;
  enrolled_at: string | null;       // yyyy-mm-dd; null when SCREENING / SCREEN_FAILURE
  current_study_day: number | null; // null when not yet enrolled
  next_visit_date: string | null;   // yyyy-mm-dd
  next_visit_name: string | null;
  assigned_coordinator: string;
  open_deviations: number;
  notes: string | null;
}

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
  SCREENING: 'Screening',
  SCREEN_FAILURE: 'Screen failure',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  WITHDRAWN: 'Withdrawn',
};

// Participants — reuses the IDs already on the calendar (mockCalendarData.ts)
// and adds a few in non-active states so the status filter has variety.
export const MOCK_PARTICIPANTS: MockParticipant[] = [
  // BRIGHTEN-2 (proto-001)
  {
    id: 'P-0019',
    protocol_id: 'proto-001',
    status: 'ACTIVE',
    enrolled_at: '2026-03-15',
    current_study_day: 28,
    next_visit_date: '2026-04-23',
    next_visit_name: 'Week 3 follow-up',
    assigned_coordinator: 'Sarah Chen',
    open_deviations: 1,
    notes: 'Missed Week 2 visit; rescheduled. Two outreach attempts logged.',
  },
  {
    id: 'P-0023',
    protocol_id: 'proto-001',
    status: 'ACTIVE',
    enrolled_at: '2026-04-14',
    current_study_day: 4,
    next_visit_date: '2026-04-27',
    next_visit_name: 'Week 1 visit',
    assigned_coordinator: 'Sarah Chen',
    open_deviations: 0,
    notes: null,
  },
  {
    id: 'P-0045',
    protocol_id: 'proto-001',
    status: 'ACTIVE',
    enrolled_at: '2026-03-22',
    current_study_day: 35,
    next_visit_date: '2026-04-24',
    next_visit_name: 'Week 6 visit',
    assigned_coordinator: 'Megan Olsen',
    open_deviations: 0,
    notes: 'Tolerating treatment well.',
  },
  {
    id: 'P-0051',
    protocol_id: 'proto-001',
    status: 'ACTIVE',
    enrolled_at: '2026-04-06',
    current_study_day: 14,
    next_visit_date: '2026-04-24',
    next_visit_name: 'Week 2 visit (rescheduled)',
    assigned_coordinator: 'Sarah Chen',
    open_deviations: 1,
    notes: 'Window-overdue Week 2 visit. Vendor lab confirmed sample handling.',
  },
  {
    id: 'P-0011',
    protocol_id: 'proto-001',
    status: 'SCREEN_FAILURE',
    enrolled_at: null,
    current_study_day: null,
    next_visit_date: null,
    next_visit_name: null,
    assigned_coordinator: 'Sarah Chen',
    open_deviations: 0,
    notes: 'Failed inclusion criterion 4.2 — labs out of range.',
  },
  {
    id: 'P-0005',
    protocol_id: 'proto-001',
    status: 'WITHDRAWN',
    enrolled_at: '2026-02-08',
    current_study_day: 41,
    next_visit_date: null,
    next_visit_name: null,
    assigned_coordinator: 'Megan Olsen',
    open_deviations: 0,
    notes: 'Withdrew consent on Day 41. AE under follow-up.',
  },
  {
    id: 'P-0030',
    protocol_id: 'proto-001',
    status: 'COMPLETED',
    enrolled_at: '2026-01-12',
    current_study_day: 84,
    next_visit_date: null,
    next_visit_name: null,
    assigned_coordinator: 'Sarah Chen',
    open_deviations: 0,
    notes: 'Completed all scheduled visits. Final database lock pending.',
  },
  {
    id: 'P-0061',
    protocol_id: 'proto-001',
    status: 'SCREENING',
    enrolled_at: null,
    current_study_day: null,
    next_visit_date: '2026-05-02',
    next_visit_name: 'Screening visit',
    assigned_coordinator: 'Sarah Chen',
    open_deviations: 0,
    notes: 'Referred this week. Consent appointment scheduled.',
  },

  // CARDIAC-7 (proto-002)
  {
    id: 'P-0008',
    protocol_id: 'proto-002',
    status: 'ACTIVE',
    enrolled_at: '2026-04-20',
    current_study_day: 1,
    next_visit_date: '2026-04-23',
    next_visit_name: 'Day 4 baseline',
    assigned_coordinator: 'Lina Ali',
    open_deviations: 0,
    notes: null,
  },
  {
    id: 'P-0012',
    protocol_id: 'proto-002',
    status: 'ACTIVE',
    enrolled_at: '2026-04-08',
    current_study_day: 14,
    next_visit_date: '2026-04-22',
    next_visit_name: 'Day 14 visit',
    assigned_coordinator: 'Lina Ali',
    open_deviations: 1,
    notes: 'Visit window deviation logged. PI signed off.',
  },

  // IMMUNE-14 (proto-003)
  {
    id: 'P-0031',
    protocol_id: 'proto-003',
    status: 'ACTIVE',
    enrolled_at: '2026-04-07',
    current_study_day: 15,
    next_visit_date: '2026-04-24',
    next_visit_name: 'Post-dose follow-up',
    assigned_coordinator: 'Tom Walsh',
    open_deviations: 0,
    notes: 'Dose 1 + Dose 2 administered without AE.',
  },
];

// =============================================================================
// Team — site staff and the delegation log
// =============================================================================

export type TeamRole = 'PI' | 'SUB_I' | 'COORDINATOR' | 'NURSE' | 'PHARMACIST' | 'MONITOR';

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  PI: 'Principal investigator',
  SUB_I: 'Sub-investigator',
  COORDINATOR: 'Study coordinator',
  NURSE: 'Research nurse',
  PHARMACIST: 'Research pharmacist',
  MONITOR: 'Monitor (CRA)',
};

export const TEAM_ROLE_SHORT: Record<TeamRole, string> = {
  PI: 'PI',
  SUB_I: 'Sub-I',
  COORDINATOR: 'Coordinator',
  NURSE: 'Nurse',
  PHARMACIST: 'Pharmacist',
  MONITOR: 'Monitor',
};

export type TeamMemberStatus = 'ACTIVE' | 'INACTIVE';

export interface MockTeamMember {
  id: string;
  protocol_id: string;
  name: string;
  role: TeamRole;
  email: string;
  delegated_tasks: string[];     // e.g. "Informed consent", "IP administration"
  certified_through: string;     // yyyy-mm-dd — GCP cert expiry
  added_at: string;              // yyyy-mm-dd — when they joined the protocol
  status: TeamMemberStatus;
  notes: string | null;
}

// Common delegation task vocab — pulled from a typical site delegation log.
// Real audit-grade lists would come from the protocol; this is illustrative.
export const COMMON_DELEGATED_TASKS = [
  'Informed consent',
  'Eligibility assessment',
  'Medical history',
  'Physical examination',
  'Vitals',
  'ECG',
  'Phlebotomy',
  'IP administration',
  'IP accountability',
  'AE assessment',
  'Concomitant meds review',
  'Source data entry',
  'Query resolution',
  'PRO administration',
  'Randomization',
] as const;
