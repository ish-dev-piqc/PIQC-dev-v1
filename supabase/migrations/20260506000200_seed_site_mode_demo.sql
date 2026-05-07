-- =============================================================================
-- Site Mode demo seed.
--
-- Inserts three demo protocols (BRIGHTEN-2, CARDIAC-7, IMMUNE-14) and
-- corresponding participants, visits, and team rosters ported from the
-- old mock files (src/lib/mockSiteData.ts, src/lib/mockCalendarData.ts).
--
-- Idempotent: ON CONFLICT clauses guard against re-runs for tables with
-- natural keys; tables without one (site_visits, site_team_members) skip
-- the whole insert if any row exists for the BRIGHTEN protocol.
--
-- All FK joins resolved via study_number / participant_code, no UUIDs.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Protocols
-- ---------------------------------------------------------------------------
INSERT INTO protocols (study_number, title, sponsor) VALUES
  ('BRIGHTEN-2', 'BRIGHTEN-2: Phase 2 study evaluating investigational therapy in major depressive disorder', 'Demo Sponsor A'),
  ('CARDIAC-7',  'CARDIAC-7: Phase 3 outcomes trial in chronic heart failure',                                 'Demo Sponsor B'),
  ('IMMUNE-14',  'IMMUNE-14: Phase 1 first-in-human dose-escalation in autoimmune disease',                    'Demo Sponsor C')
ON CONFLICT (study_number) DO NOTHING;


-- ---------------------------------------------------------------------------
-- site_participants
-- ---------------------------------------------------------------------------
INSERT INTO site_participants
  (participant_code, protocol_id, status, enrolled_at, current_study_day,
   next_visit_date, next_visit_name, assigned_coordinator, open_deviations, notes)
VALUES
  -- BRIGHTEN-2
  ('P-0019', (SELECT id FROM protocols WHERE study_number = 'BRIGHTEN-2'), 'ACTIVE',         '2026-03-15', 28,   '2026-04-23', 'Week 3 follow-up',           'Sarah Chen',  1, 'Missed Week 2 visit; rescheduled. Two outreach attempts logged.'),
  ('P-0023', (SELECT id FROM protocols WHERE study_number = 'BRIGHTEN-2'), 'ACTIVE',         '2026-04-14', 4,    '2026-04-27', 'Week 1 visit',               'Sarah Chen',  0, NULL),
  ('P-0045', (SELECT id FROM protocols WHERE study_number = 'BRIGHTEN-2'), 'ACTIVE',         '2026-03-22', 35,   '2026-04-24', 'Week 6 visit',               'Megan Olsen', 0, 'Tolerating treatment well.'),
  ('P-0051', (SELECT id FROM protocols WHERE study_number = 'BRIGHTEN-2'), 'ACTIVE',         '2026-04-06', 14,   '2026-04-24', 'Week 2 visit (rescheduled)', 'Sarah Chen',  1, 'Window-overdue Week 2 visit. Vendor lab confirmed sample handling.'),
  ('P-0011', (SELECT id FROM protocols WHERE study_number = 'BRIGHTEN-2'), 'SCREEN_FAILURE', NULL,         NULL, NULL,         NULL,                         'Sarah Chen',  0, 'Failed inclusion criterion 4.2 — labs out of range.'),
  ('P-0005', (SELECT id FROM protocols WHERE study_number = 'BRIGHTEN-2'), 'WITHDRAWN',      '2026-02-08', 41,   NULL,         NULL,                         'Megan Olsen', 0, 'Withdrew consent on Day 41. AE under follow-up.'),
  ('P-0030', (SELECT id FROM protocols WHERE study_number = 'BRIGHTEN-2'), 'COMPLETED',      '2026-01-12', 84,   NULL,         NULL,                         'Sarah Chen',  0, 'Completed all scheduled visits. Final database lock pending.'),
  ('P-0061', (SELECT id FROM protocols WHERE study_number = 'BRIGHTEN-2'), 'SCREENING',      NULL,         NULL, '2026-05-02', 'Screening visit',            'Sarah Chen',  0, 'Referred this week. Consent appointment scheduled.'),
  -- CARDIAC-7
  ('P-0008', (SELECT id FROM protocols WHERE study_number = 'CARDIAC-7'),  'ACTIVE',         '2026-04-20', 1,    '2026-04-23', 'Day 4 baseline',             'Lina Ali',    0, NULL),
  ('P-0012', (SELECT id FROM protocols WHERE study_number = 'CARDIAC-7'),  'ACTIVE',         '2026-04-08', 14,   '2026-04-22', 'Day 14 visit',               'Lina Ali',    1, 'Visit window deviation logged. PI signed off.'),
  -- IMMUNE-14
  ('P-0031', (SELECT id FROM protocols WHERE study_number = 'IMMUNE-14'),  'ACTIVE',         '2026-04-07', 15,   '2026-04-24', 'Post-dose follow-up',        'Tom Walsh',   0, 'Dose 1 + Dose 2 administered without AE.')
ON CONFLICT (participant_code, protocol_id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- site_visits — guarded against re-runs (no natural unique key)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  brighten_id uuid := (SELECT id FROM protocols WHERE study_number = 'BRIGHTEN-2');
  cardiac_id  uuid := (SELECT id FROM protocols WHERE study_number = 'CARDIAC-7');
  immune_id   uuid := (SELECT id FROM protocols WHERE study_number = 'IMMUNE-14');

  -- participant id helpers (joined to protocol)
  pid_0019 uuid := (SELECT id FROM site_participants WHERE participant_code = 'P-0019' AND protocol_id = brighten_id);
  pid_0023 uuid := (SELECT id FROM site_participants WHERE participant_code = 'P-0023' AND protocol_id = brighten_id);
  pid_0045 uuid := (SELECT id FROM site_participants WHERE participant_code = 'P-0045' AND protocol_id = brighten_id);
  pid_0051 uuid := (SELECT id FROM site_participants WHERE participant_code = 'P-0051' AND protocol_id = brighten_id);
  pid_0008 uuid := (SELECT id FROM site_participants WHERE participant_code = 'P-0008' AND protocol_id = cardiac_id);
  pid_0012 uuid := (SELECT id FROM site_participants WHERE participant_code = 'P-0012' AND protocol_id = cardiac_id);
  pid_0031 uuid := (SELECT id FROM site_participants WHERE participant_code = 'P-0031' AND protocol_id = immune_id);
BEGIN
  IF EXISTS (SELECT 1 FROM site_visits WHERE protocol_id = brighten_id) THEN
    RETURN;
  END IF;

  INSERT INTO site_visits
    (participant_id, protocol_id, date, time_of_day, study_day, visit_name, window_closes, status, procedures, prior_note, deviation_reason)
  VALUES
    -- PAST WEEK
    (pid_0045, brighten_id, '2026-04-13', '9:00 AM',  28, 'Week 4 follow-up',      NULL,                          'completed',    ARRAY['Vitals','PK blood draw','AE check','Concomitant meds review'], 'Previous visit completed on schedule. No AEs reported.', NULL),
    (pid_0023, brighten_id, '2026-04-14', '10:30 AM', 1,  'Screening visit',       NULL,                          'completed',    ARRAY['Informed consent','Eligibility review','Medical history','Labs'], 'New enrollment.', NULL),
    (pid_0012, cardiac_id,  '2026-04-15', '2:00 PM',  7,  'Day 7 visit',           NULL,                          'deviation',    ARRAY['ECG','Vitals','Drug dispensation'], 'Participant arrived 4 hours outside visit window.', 'Visit conducted outside protocol-defined window (+/- 2 days). PI notified, deviation logged.'),
    (pid_0019, brighten_id, '2026-04-16', '11:00 AM', 14, 'Week 2 visit',          NULL,                          'missed',       ARRAY['Vitals','AE check','Labs'], 'Participant did not show. Two contact attempts made.', NULL),
    (pid_0031, immune_id,   '2026-04-17', '9:30 AM',  1,  'Dose 1 administration', NULL,                          'completed',    ARRAY['Pre-dose vitals','IV infusion (60 min)','Post-dose observation (2h)'], 'Screening completed 2 weeks prior. Eligibility confirmed.', NULL),
    -- THIS WEEK PAST
    (pid_0008, cardiac_id,  '2026-04-20', '8:30 AM',  1,  'Screening visit',       NULL,                          'completed',    ARRAY['Informed consent','Eligibility review','Baseline labs','ECG'], 'Referred by cardiology. Consented without issue.', NULL),
    (pid_0051, brighten_id, '2026-04-20', '1:00 PM',  14, 'Week 2 visit',          '2026-04-24T17:00:00+00:00'::timestamptz, 'overdue',      ARRAY['Vitals','AE check','Blood draw'], 'Participant rescheduled from original date. Window still open.', NULL),
    (pid_0045, brighten_id, '2026-04-21', '10:00 AM', 35, 'Week 5 check-in',       NULL,                          'completed',    ARRAY['Vitals','AE check'], 'No changes since last visit.', NULL),
    -- TODAY
    (pid_0023, brighten_id, '2026-04-22', '9:00 AM',  4,  'Day 4 baseline',        NULL,                          'scheduled',    ARRAY['Vitals','Baseline labs','Pre-treatment ECG','PRO questionnaires'], 'Screening completed Apr 14. Participant confirmed attendance.', NULL),
    (pid_0012, cardiac_id,  '2026-04-22', '11:30 AM', 14, 'Day 14 visit',          '2026-04-22T17:00:00+00:00'::timestamptz, 'closing_soon', ARRAY['ECG','Vitals','Drug dispensation','AE check'], 'Previous visit had window deviation. Please confirm arrival on time.', NULL),
    (pid_0031, immune_id,   '2026-04-22', '2:00 PM',  15, 'Dose 2 administration', NULL,                          'scheduled',    ARRAY['Pre-dose vitals','IV infusion (60 min)','Post-dose observation (2h)'], 'Dose 1 tolerated well. No AEs.', NULL),
    -- UPCOMING
    (pid_0019, brighten_id, '2026-04-23', '9:30 AM',  21, 'Week 3 follow-up',      NULL,                          'scheduled',    ARRAY['Vitals','AE check','Labs'], 'Previous Week 2 visit was missed. Reschedule confirmed.', NULL),
    (pid_0008, cardiac_id,  '2026-04-23', '2:30 PM',  4,  'Day 4 baseline',        NULL,                          'scheduled',    ARRAY['Vitals','Baseline ECG','Labs','Study drug dispensation'], 'Screening completed Apr 20.', NULL),
    (pid_0045, brighten_id, '2026-04-24', '10:00 AM', 42, 'Week 6 visit',          NULL,                          'scheduled',    ARRAY['Vitals','Labs','AE check','PRO questionnaires'], 'Maintenance visit. On schedule.', NULL),
    (pid_0031, immune_id,   '2026-04-24', '1:30 PM',  17, 'Post-dose follow-up',   NULL,                          'scheduled',    ARRAY['Vitals','AE check','Blood draw'], 'Safety follow-up after Dose 2.', NULL),
    (pid_0023, brighten_id, '2026-04-27', '9:00 AM',  9,  'Week 1 visit',          NULL,                          'scheduled',    ARRAY['Vitals','AE check','Labs','Study drug dispensation'], 'First post-baseline visit.', NULL);
END $$;


-- ---------------------------------------------------------------------------
-- site_team_members — guarded against re-runs
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  brighten_id uuid := (SELECT id FROM protocols WHERE study_number = 'BRIGHTEN-2');
  cardiac_id  uuid := (SELECT id FROM protocols WHERE study_number = 'CARDIAC-7');
  immune_id   uuid := (SELECT id FROM protocols WHERE study_number = 'IMMUNE-14');
BEGIN
  IF EXISTS (SELECT 1 FROM site_team_members WHERE protocol_id = brighten_id) THEN
    RETURN;
  END IF;

  INSERT INTO site_team_members
    (protocol_id, name, role, email, delegated_tasks, certified_through, added_at, status, notes)
  VALUES
    -- BRIGHTEN-2
    (brighten_id, 'Dr. Maria Reyes',    'PI',          'maria.reyes@example.com',   ARRAY['Eligibility assessment','Medical history','Physical examination','AE assessment'], '2027-01-31', '2026-01-05', 'ACTIVE',   'Site PI. Final sign-off authority for eligibility and AE causality.'),
    (brighten_id, 'Dr. Jin Kim',        'SUB_I',       'jin.kim@example.com',       ARRAY['Eligibility assessment','Physical examination','AE assessment'],                  '2026-11-15', '2026-01-05', 'ACTIVE',   NULL),
    (brighten_id, 'Sarah Chen',         'COORDINATOR', 'sarah.chen@example.com',    ARRAY['Informed consent','Medical history','Vitals','Source data entry','Query resolution','Concomitant meds review'], '2027-03-22', '2026-01-05', 'ACTIVE', 'Lead coordinator.'),
    (brighten_id, 'Megan Olsen',        'NURSE',       'megan.olsen@example.com',   ARRAY['Vitals','ECG','Phlebotomy','IP administration'],                                  '2026-09-30', '2026-01-15', 'ACTIVE',   NULL),
    (brighten_id, 'Rakesh Patel',       'PHARMACIST',  'rakesh.patel@example.com',  ARRAY['IP accountability','Randomization'],                                              '2027-02-28', '2026-01-05', 'ACTIVE',   NULL),
    (brighten_id, 'Casey Brooks',       'MONITOR',     'casey.brooks@example.com',  ARRAY[]::TEXT[],                                                                         '2027-06-01', '2026-01-30', 'ACTIVE',   'CRA. Visit monitoring only — no delegated site tasks.'),
    (brighten_id, 'Dr. Adaora Okafor',  'SUB_I',       'adaora.okafor@example.com', ARRAY['Eligibility assessment','Physical examination'],                                  '2026-04-20', '2026-02-12', 'INACTIVE', 'Cert expired Apr 20. Reactivation pending refresh training.'),
    -- CARDIAC-7
    (cardiac_id,  'Dr. Hyun Park',      'PI',          'hyun.park@example.com',     ARRAY['Eligibility assessment','Medical history','Physical examination','AE assessment'], '2027-04-10', '2026-03-01', 'ACTIVE', NULL),
    (cardiac_id,  'Lina Ali',           'COORDINATOR', 'lina.ali@example.com',      ARRAY['Informed consent','Vitals','ECG','Source data entry','Query resolution'],         '2027-01-15', '2026-03-01', 'ACTIVE', NULL),
    -- IMMUNE-14
    (immune_id,   'Dr. Yui Nakamura',   'PI',          'yui.nakamura@example.com',  ARRAY['Eligibility assessment','Medical history','AE assessment'],                       '2027-05-20', '2026-02-20', 'ACTIVE', NULL),
    (immune_id,   'Tom Walsh',          'COORDINATOR', 'tom.walsh@example.com',     ARRAY['Informed consent','PRO administration','Source data entry','IP administration'], '2026-12-08', '2026-02-20', 'ACTIVE', NULL);
END $$;
