// =============================================================================
// Site Mode — UI label maps + delegation-task vocabulary.
//
// Pure display-string constants extracted from the old mockSiteData.ts so the
// mock fixture file can be deleted. Components import these for status pills,
// role chips, and delegation autocomplete.
// =============================================================================

import type { ParticipantStatus, TeamRole } from './types';

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
  SCREENING: 'Screening',
  SCREEN_FAILURE: 'Screen failure',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  WITHDRAWN: 'Withdrawn',
};

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

// Common delegation task vocab — typical site delegation log.
// Used by future Team CRUD (autocomplete on the delegated-tasks field).
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
