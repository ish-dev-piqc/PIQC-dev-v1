// =============================================================================
// Mock data for Site Mode (Participants + Team tabs).
//
// Visits are already in mockCalendarData.ts and shared with the Overview tab.
// This file adds participant rosters and team/delegation data per protocol.
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

export const MOCK_TEAM: MockTeamMember[] = [
  // BRIGHTEN-2 team
  {
    id: 'tm-001-1',
    protocol_id: 'proto-001',
    name: 'Dr. Maria Reyes',
    role: 'PI',
    email: 'maria.reyes@example.com',
    delegated_tasks: [
      'Eligibility assessment',
      'Medical history',
      'Physical examination',
      'AE assessment',
    ],
    certified_through: '2027-01-31',
    added_at: '2026-01-05',
    status: 'ACTIVE',
    notes: 'Site PI. Final sign-off authority for eligibility and AE causality.',
  },
  {
    id: 'tm-001-2',
    protocol_id: 'proto-001',
    name: 'Dr. Jin Kim',
    role: 'SUB_I',
    email: 'jin.kim@example.com',
    delegated_tasks: [
      'Eligibility assessment',
      'Physical examination',
      'AE assessment',
    ],
    certified_through: '2026-11-15',
    added_at: '2026-01-05',
    status: 'ACTIVE',
    notes: null,
  },
  {
    id: 'tm-001-3',
    protocol_id: 'proto-001',
    name: 'Sarah Chen',
    role: 'COORDINATOR',
    email: 'sarah.chen@example.com',
    delegated_tasks: [
      'Informed consent',
      'Medical history',
      'Vitals',
      'Source data entry',
      'Query resolution',
      'Concomitant meds review',
    ],
    certified_through: '2027-03-22',
    added_at: '2026-01-05',
    status: 'ACTIVE',
    notes: 'Lead coordinator.',
  },
  {
    id: 'tm-001-4',
    protocol_id: 'proto-001',
    name: 'Megan Olsen',
    role: 'NURSE',
    email: 'megan.olsen@example.com',
    delegated_tasks: ['Vitals', 'ECG', 'Phlebotomy', 'IP administration'],
    certified_through: '2026-09-30',
    added_at: '2026-01-15',
    status: 'ACTIVE',
    notes: null,
  },
  {
    id: 'tm-001-5',
    protocol_id: 'proto-001',
    name: 'Rakesh Patel',
    role: 'PHARMACIST',
    email: 'rakesh.patel@example.com',
    delegated_tasks: ['IP accountability', 'Randomization'],
    certified_through: '2027-02-28',
    added_at: '2026-01-05',
    status: 'ACTIVE',
    notes: null,
  },
  {
    id: 'tm-001-6',
    protocol_id: 'proto-001',
    name: 'Casey Brooks',
    role: 'MONITOR',
    email: 'casey.brooks@example.com',
    delegated_tasks: [],
    certified_through: '2027-06-01',
    added_at: '2026-01-30',
    status: 'ACTIVE',
    notes: 'CRA. Visit monitoring only — no delegated site tasks.',
  },
  {
    id: 'tm-001-7',
    protocol_id: 'proto-001',
    name: 'Dr. Adaora Okafor',
    role: 'SUB_I',
    email: 'adaora.okafor@example.com',
    delegated_tasks: ['Eligibility assessment', 'Physical examination'],
    certified_through: '2026-04-20',
    added_at: '2026-02-12',
    status: 'INACTIVE',
    notes: 'Cert expired Apr 20. Reactivation pending refresh training.',
  },

  // CARDIAC-7 team
  {
    id: 'tm-002-1',
    protocol_id: 'proto-002',
    name: 'Dr. Hyun Park',
    role: 'PI',
    email: 'hyun.park@example.com',
    delegated_tasks: [
      'Eligibility assessment',
      'Medical history',
      'Physical examination',
      'AE assessment',
    ],
    certified_through: '2027-04-10',
    added_at: '2026-03-01',
    status: 'ACTIVE',
    notes: null,
  },
  {
    id: 'tm-002-2',
    protocol_id: 'proto-002',
    name: 'Lina Ali',
    role: 'COORDINATOR',
    email: 'lina.ali@example.com',
    delegated_tasks: [
      'Informed consent',
      'Vitals',
      'ECG',
      'Source data entry',
      'Query resolution',
    ],
    certified_through: '2027-01-15',
    added_at: '2026-03-01',
    status: 'ACTIVE',
    notes: null,
  },

  // IMMUNE-14 team
  {
    id: 'tm-003-1',
    protocol_id: 'proto-003',
    name: 'Dr. Yui Nakamura',
    role: 'PI',
    email: 'yui.nakamura@example.com',
    delegated_tasks: [
      'Eligibility assessment',
      'Medical history',
      'AE assessment',
    ],
    certified_through: '2027-05-20',
    added_at: '2026-02-20',
    status: 'ACTIVE',
    notes: null,
  },
  {
    id: 'tm-003-2',
    protocol_id: 'proto-003',
    name: 'Tom Walsh',
    role: 'COORDINATOR',
    email: 'tom.walsh@example.com',
    delegated_tasks: [
      'Informed consent',
      'PRO administration',
      'Source data entry',
      'IP administration',
    ],
    certified_through: '2026-12-08',
    added_at: '2026-02-20',
    status: 'ACTIVE',
    notes: null,
  },
];
