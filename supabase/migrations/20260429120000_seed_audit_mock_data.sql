-- =============================================================================
-- Audit Mode — dev seed data
--
-- Defines `seed_audit_mock_data(auditor_id UUID, auditor_name TEXT)`, a
-- one-shot function that populates 3 representative audits across different
-- stages so the frontend has something real to read/write while we wire it up.
--
-- Usage (from Supabase SQL editor, after signing in once so auth.users has a
-- row for you):
--
--   select seed_audit_mock_data('<your-auth-user-id>'::uuid, 'Your Name');
--
-- SECURITY DEFINER so it bypasses RLS during the seed. Idempotent: if the
-- BRIGHTEN-2 audit already exists it returns 'already seeded' and exits.
--
-- Three seeded audits (matches the existing mocks in src/lib/audit/):
--   audit-001 (BRIGHTEN-2)  — QUESTIONNAIRE_REVIEW
--   audit-002 (CARDIAC-7)   — INTAKE
--   audit-003 (IMMUNE-14)   — PRE_AUDIT_DRAFTING
-- =============================================================================

CREATE OR REPLACE FUNCTION seed_audit_mock_data(
  auditor_id   UUID,
  auditor_name TEXT DEFAULT 'Test Auditor'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Deterministic UUIDs so re-runs and FKs stay stable.
  v_aurora UUID := '11111111-1111-1111-1111-111111111101';
  v_helix  UUID := '11111111-1111-1111-1111-111111111102';
  v_pulse  UUID := '11111111-1111-1111-1111-111111111103';

  p_brighten UUID := '22222222-2222-2222-2222-222222222201';
  p_cardiac  UUID := '22222222-2222-2222-2222-222222222202';
  p_immune   UUID := '22222222-2222-2222-2222-222222222203';

  pv_brighten UUID := '33333333-3333-3333-3333-333333333301';
  pv_cardiac  UUID := '33333333-3333-3333-3333-333333333302';
  pv_immune   UUID := '33333333-3333-3333-3333-333333333303';

  qt_id  UUID := '44444444-4444-4444-4444-444444444401';
  qtv_id UUID := '44444444-4444-4444-4444-444444444411';

  a1 UUID := '55555555-5555-5555-5555-555555555501';
  a2 UUID := '55555555-5555-5555-5555-555555555502';
  a3 UUID := '55555555-5555-5555-5555-555555555503';

  -- Protocol risks (audit-001 = 5, audit-002 = 2, audit-003 = 3)
  pr_001_01 UUID := '66666666-6666-6666-6666-660000000101';
  pr_001_02 UUID := '66666666-6666-6666-6666-660000000102';
  pr_001_03 UUID := '66666666-6666-6666-6666-660000000103';
  pr_001_04 UUID := '66666666-6666-6666-6666-660000000104';
  pr_001_05 UUID := '66666666-6666-6666-6666-660000000105';
  pr_002_01 UUID := '66666666-6666-6666-6666-660000000201';
  pr_002_02 UUID := '66666666-6666-6666-6666-660000000202';
  pr_003_01 UUID := '66666666-6666-6666-6666-660000000301';
  pr_003_02 UUID := '66666666-6666-6666-6666-660000000302';
  pr_003_03 UUID := '66666666-6666-6666-6666-660000000303';

  -- Vendor services
  vs_001 UUID := '77777777-7777-7777-7777-770000000001';
  vs_003 UUID := '77777777-7777-7777-7777-770000000003';

  -- Service mappings
  sm_001_01 UUID := '88888888-8888-8888-8888-880000000101';
  sm_001_02 UUID := '88888888-8888-8888-8888-880000000102';
  sm_001_03 UUID := '88888888-8888-8888-8888-880000000103';
  sm_001_04 UUID := '88888888-8888-8888-8888-880000000104';
  sm_001_05 UUID := '88888888-8888-8888-8888-880000000105';
  sm_003_01 UUID := '88888888-8888-8888-8888-880000000301';
  sm_003_02 UUID := '88888888-8888-8888-8888-880000000302';
  sm_003_03 UUID := '88888888-8888-8888-8888-880000000303';

  -- Trust assessments
  ta_001 UUID := '99999999-9999-9999-9999-990000000001';
  ta_003 UUID := '99999999-9999-9999-9999-990000000003';

  -- Risk summaries
  rs_001 UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aa0000000001';
  rs_003 UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aa0000000003';

  -- Questionnaire instances
  qi_001 UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bb0000000001';
  qi_003 UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bb0000000003';

  -- Pre-audit deliverables (audit-003 only)
  cl_003 UUID := 'cccccccc-cccc-cccc-cccc-cc0000000003';
  ag_003 UUID := 'cccccccc-cccc-cccc-cccc-cc0000000013';
  ch_003 UUID := 'cccccccc-cccc-cccc-cccc-cc0000000023';

  -- A few questionnaire questions (template + addenda) — small representative slice
  q_t_1_1_1 UUID := 'dddddddd-dddd-dddd-dddd-dd0000000111';
  q_t_1_1_2 UUID := 'dddddddd-dddd-dddd-dddd-dd0000000112';
  q_t_4_1_1 UUID := 'dddddddd-dddd-dddd-dddd-dd0000000411';
  q_t_5_2_1 UUID := 'dddddddd-dddd-dddd-dddd-dd0000000521';
  q_a_brighten_1 UUID := 'dddddddd-dddd-dddd-dddd-dd00b0000001';
  q_a_immune_1   UUID := 'dddddddd-dddd-dddd-dddd-dd00f0000001';
  q_a_immune_2   UUID := 'dddddddd-dddd-dddd-dddd-dd00f0000002';

  -- Workspace entries (audit-003 only — audit-001 hasn't reached AUDIT_CONDUCT)
  we_003_1 UUID := 'eeeeeeee-eeee-eeee-eeee-ee0000000001';
  we_003_2 UUID := 'eeeeeeee-eeee-eeee-eeee-ee0000000002';
  we_003_3 UUID := 'eeeeeeee-eeee-eeee-eeee-ee0000000003';
BEGIN
  -- -------------------------------------------------------------------------
  -- Idempotency guard
  -- -------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM audits WHERE id = a1) THEN
    RETURN 'already seeded — no changes made';
  END IF;

  -- -------------------------------------------------------------------------
  -- 1. user_profile for the auditor
  -- -------------------------------------------------------------------------
  INSERT INTO user_profiles (id, name, role)
  VALUES (auditor_id, auditor_name, 'LEAD_AUDITOR')
  ON CONFLICT (id) DO NOTHING;

  -- -------------------------------------------------------------------------
  -- 2. Vendors
  -- -------------------------------------------------------------------------
  INSERT INTO vendors (id, name, legal_name, country, website) VALUES
    (v_aurora, 'Aurora Clinical Services',  'Aurora Clinical Services Ltd', 'United Kingdom', 'https://aurora-cs.example'),
    (v_helix,  'Helix Diagnostics',         'Helix Diagnostics Inc',        'United States',  'https://helix-dx.example'),
    (v_pulse,  'PatientPulse Technologies', 'PatientPulse Technologies SA', 'Switzerland',    'https://patientpulse.example');

  -- -------------------------------------------------------------------------
  -- 3. Protocols + protocol versions
  -- -------------------------------------------------------------------------
  INSERT INTO protocols (id, study_number, title, sponsor) VALUES
    (p_brighten, 'BRIGHTEN-2', 'BRIGHTEN-2: Phase 3 Oncology Study',          'Sponsor A'),
    (p_cardiac,  'CARDIAC-7',  'CARDIAC-7: Heart Failure Intervention',       'Sponsor B'),
    (p_immune,   'IMMUNE-14',  'IMMUNE-14: Autoimmune Biologic Trial',        'Sponsor C');

  INSERT INTO protocol_versions
    (id, protocol_id, version_number, status, clinical_trial_phase, piqc_protocol_id, raw_piqc_payload, effective_date)
  VALUES
    (pv_brighten, p_brighten, 1, 'ACTIVE', 'PHASE_3',   'piqc-stub-brighten-1', '{}'::jsonb, '2026-01-15'),
    (pv_cardiac,  p_cardiac,  1, 'ACTIVE', 'PHASE_2_3', 'piqc-stub-cardiac-1',  '{}'::jsonb, '2026-02-10'),
    (pv_immune,   p_immune,   1, 'ACTIVE', 'PHASE_2',   'piqc-stub-immune-1',   '{}'::jsonb, '2026-01-30');

  -- -------------------------------------------------------------------------
  -- 4. Questionnaire template + version (one canonical template)
  -- -------------------------------------------------------------------------
  INSERT INTO questionnaire_templates (id, slug, name, description, is_default) VALUES
    (qt_id, 'standard-gcp-vendor', 'Standard GCP Vendor Questionnaire',
     'Canonical baseline questionnaire applied to every audit.', TRUE);

  INSERT INTO questionnaire_template_versions (id, template_id, version_number, notes) VALUES
    (qtv_id, qt_id, 1, 'Initial seeded version.');

  -- -------------------------------------------------------------------------
  -- 5. Protocol risk objects (Stage 1 data)
  -- -------------------------------------------------------------------------
  -- audit-001 (BRIGHTEN-2)
  INSERT INTO protocol_risk_objects
    (id, protocol_version_id, section_identifier, section_title, endpoint_tier, impact_surface,
     time_sensitivity, vendor_dependency_flags, operational_domain_tag, tagging_mode, version_change_type,
     tagged_by, tagged_at)
  VALUES
    (pr_001_01, pv_brighten, '7.1', 'Primary endpoint analysis (overall survival)', 'PRIMARY',   'DATA_INTEGRITY', FALSE, ARRAY['cro_full_service','biostats'], 'biostats',         'MANUAL', 'ADDED', auditor_id, NOW()),
    (pr_001_02, pv_brighten, '5.4', 'Randomization procedures',                     'SECONDARY', 'DATA_INTEGRITY', TRUE,  ARRAY['IVRS'],                          'IVRS',              'MANUAL', 'ADDED', auditor_id, NOW()),
    (pr_001_03, pv_brighten, '6.2', 'Data management plan',                         'SECONDARY', 'DATA_INTEGRITY', FALSE, ARRAY['EDC','cro_full_service'],        'EDC',               'MANUAL', 'ADDED', auditor_id, NOW()),
    (pr_001_04, pv_brighten, '8.1', 'Adverse event reporting',                      'SAFETY',    'PATIENT_SAFETY', TRUE,  ARRAY['pharmacovigilance','cro_full_service'], 'pharmacovigilance', 'MANUAL', 'ADDED', auditor_id, NOW()),
    (pr_001_05, pv_brighten, '6.5', 'Trial master file management',                 'SUPPORTIVE','DATA_INTEGRITY', FALSE, ARRAY['eTMF'],                          'eTMF',              'MANUAL', 'ADDED', auditor_id, NOW()),
  -- audit-002 (CARDIAC-7)
    (pr_002_01, pv_cardiac, '7.1', 'Primary endpoint (NT-proBNP at week 12)',       'PRIMARY',   'DATA_INTEGRITY', TRUE,  ARRAY['central_lab'],                   'central_lab',       'MANUAL', 'ADDED', auditor_id, NOW()),
    (pr_002_02, pv_cardiac, '5.6', 'ECG safety monitoring',                         'SAFETY',    'PATIENT_SAFETY', TRUE,  ARRAY['ECG'],                           'ECG',               'MANUAL', 'ADDED', auditor_id, NOW()),
  -- audit-003 (IMMUNE-14)
    (pr_003_01, pv_immune, '6.1', 'PRO assessment schedule',                        'PRIMARY',   'DATA_INTEGRITY', TRUE,  ARRAY['ePRO'],                          'ePRO',              'MANUAL', 'ADDED', auditor_id, NOW()),
    (pr_003_02, pv_immune, '7.2', 'Disease activity score derivation',              'PRIMARY',   'DATA_INTEGRITY', FALSE, ARRAY['ePRO'],                          'ePRO',              'MANUAL', 'ADDED', auditor_id, NOW()),
    (pr_003_03, pv_immune, '8.4', 'Patient device hygiene SOPs',                    'SUPPORTIVE','BOTH',           FALSE, ARRAY['ePRO'],                          'ePRO',              'MANUAL', 'ADDED', auditor_id, NOW());

  -- -------------------------------------------------------------------------
  -- 6. Audits
  -- -------------------------------------------------------------------------
  INSERT INTO audits
    (id, vendor_id, protocol_id, protocol_version_id, audit_name, audit_type, status, current_stage, lead_auditor_id, scheduled_date)
  VALUES
    (a1, v_aurora, p_brighten, pv_brighten, 'CRO QC oversight — BRIGHTEN-2',           'REMOTE', 'IN_PROGRESS', 'QUESTIONNAIRE_REVIEW', auditor_id, '2026-05-15'),
    (a2, v_helix,  p_cardiac,  pv_cardiac,  'Central lab data integrity — CARDIAC-7',  'ONSITE', 'DRAFT',       'INTAKE',               auditor_id, '2026-06-08'),
    (a3, v_pulse,  p_immune,   pv_immune,   'ePRO platform GxP audit — IMMUNE-14',     'HYBRID', 'IN_PROGRESS', 'PRE_AUDIT_DRAFTING',   auditor_id, '2026-05-22');

  -- -------------------------------------------------------------------------
  -- 7. Vendor service objects + mappings (Stage 2)
  -- audit-002 has none yet — still in INTAKE.
  -- -------------------------------------------------------------------------
  INSERT INTO vendor_service_objects (id, audit_id, service_name, service_type, service_description) VALUES
    (vs_001, a1, 'Full-service CRO oversight', 'cro_full_service',
     'Aurora is contracted as the lead CRO providing data management, biostatistics, central randomization, eTMF custody, and pharmacovigilance support across all participating sites.'),
    (vs_003, a3, 'ePRO platform and patient device fleet', 'ePRO',
     'PatientPulse provides the electronic PRO platform, validated scoring engine, and managed device fleet (provisioning, hygiene, replacement) for all enrolled participants.');

  INSERT INTO vendor_service_mapping_objects (id, vendor_service_id, protocol_risk_id, derived_criticality, criticality_rationale) VALUES
    (sm_001_01, vs_001, pr_001_01, 'CRITICAL', 'Primary endpoint computation depends on this vendor; deviations directly affect study readout.'),
    (sm_001_02, vs_001, pr_001_02, 'HIGH',     'Randomization independence and audit trail integrity drive trust in the study assignment.'),
    (sm_001_03, vs_001, pr_001_03, 'HIGH',     'EDC operations and query resolution sit entirely on this vendor.'),
    (sm_001_04, vs_001, pr_001_04, 'CRITICAL', 'PV pipeline owned end-to-end by this vendor.'),
    (sm_001_05, vs_001, pr_001_05, 'MODERATE', 'eTMF completeness affects inspection-readiness but not endpoints.'),
    (sm_003_01, vs_003, pr_003_01, 'CRITICAL', 'Time-sensitive PRO capture is the primary endpoint substrate.'),
    (sm_003_02, vs_003, pr_003_02, 'CRITICAL', 'Score derivation runs inside the vendor platform.'),
    (sm_003_03, vs_003, pr_003_03, 'MODERATE', 'Operational hygiene; not direct endpoint material.');

  -- -------------------------------------------------------------------------
  -- 8. Trust assessments (Stage 2)
  -- -------------------------------------------------------------------------
  INSERT INTO trust_assessment_objects
    (id, audit_id, certifications_claimed, regulatory_claims, compliance_posture, maturity_posture,
     provisional_trust_posture, risk_hypotheses, notes, assessed_by, assessed_at)
  VALUES
    (ta_001, a1,
     ARRAY['ISO 9001:2015','ISO 27001:2022','GCP-trained staff (organisation-wide)'],
     ARRAY['FDA inspection 2024 — no critical findings','EMA QPPV registration current'],
     'STRONG','MATURE','HIGH',
     ARRAY[
       'Cross-functional handoffs between data management and biostatistics may strain QC turnaround at database lock.',
       'Vendor pivoted to a new EDC tooling stack last year — verify validation evidence is current.'
     ],
     'Public materials are detailed; vendor publishes annual quality reports with KPI trend data. No material gaps in initial review.',
     auditor_id, NOW()),
    (ta_003, a3,
     ARRAY['HITRUST CSF certified','SOC 2 Type II'],
     ARRAY['21 CFR Part 11 conformance — self-attested','GDPR DPIA available on request'],
     'STRONG','MATURE','HIGH',
     ARRAY[
       'Scoring engine versioning — confirm change control discipline given the engine sits on the endpoint critical path.',
       'Device fleet hygiene and replacement SOPs — verify documented, not relied on tribal knowledge.'
     ],
     'Vendor publishes a Part 11 white paper that maps platform features to predicate rule requirements — useful starting material for audit prep.',
     auditor_id, NOW());

  -- -------------------------------------------------------------------------
  -- 9. Risk summaries (right rail)
  -- -------------------------------------------------------------------------
  INSERT INTO vendor_risk_summary_objects
    (id, audit_id, study_context, vendor_relevance_narrative, focus_areas, approval_status, approved_at, approved_by)
  VALUES
    (rs_001, a1,
     jsonb_build_object(
       'therapeutic_space','Oncology — solid tumors',
       'primary_endpoints', ARRAY['Overall survival at 24 months'],
       'secondary_endpoints', ARRAY['Progression-free survival','Objective response rate','Safety and tolerability'],
       'clinical_trial_phase','PHASE_3',
       'captured_at','2026-04-12T14:22:00Z'
     ),
     'This vendor provides full-service CRO support including data management, biostatistics, and central randomization. Given the Phase 3 design with overall survival as the primary endpoint, audit attention should center on data lifecycle integrity from EDC capture through database lock, central randomization independence, and adherence to the statistical analysis plan. Operational reliance on the CRO spans nearly every protocol-critical function — this is a high-criticality vendor relationship.',
     ARRAY['Data integrity (EDC, query resolution)','Central randomization independence','eTMF completeness and inspection-readiness','Statistical analysis plan adherence'],
     'DRAFT', NULL, NULL),
    (rs_003, a3,
     jsonb_build_object(
       'therapeutic_space','Autoimmune — rheumatology',
       'primary_endpoints', ARRAY['Disease activity score reduction at week 24'],
       'secondary_endpoints', ARRAY['Patient-reported outcomes','Safety and tolerability'],
       'clinical_trial_phase','PHASE_2',
       'captured_at','2026-04-08T11:05:00Z'
     ),
     'This vendor provides the electronic patient-reported outcome platform. Given that the primary endpoint is a disease activity score derived in part from PRO data, ePRO platform integrity is directly material to endpoint reliability. Audit emphasis should center on 21 CFR Part 11 compliance, audit trail completeness, device provisioning hygiene, and validation of the scoring algorithms running on the platform. Time-sensitive data capture windows make platform availability and outage handling additional points of scrutiny.',
     ARRAY['21 CFR Part 11 compliance','Audit trail completeness','Device provisioning and hygiene','Scoring algorithm validation','Outage handling and data recovery'],
     'APPROVED', '2026-04-18T16:42:00Z', auditor_id);

  INSERT INTO vendor_risk_summary_protocol_risks (risk_summary_id, protocol_risk_id) VALUES
    (rs_001, pr_001_01),
    (rs_001, pr_001_02),
    (rs_001, pr_001_03),
    (rs_003, pr_003_01),
    (rs_003, pr_003_02);

  -- -------------------------------------------------------------------------
  -- 10. Questionnaire instances + a representative slice of questions/responses
  -- -------------------------------------------------------------------------
  INSERT INTO questionnaire_instances
    (id, audit_id, template_version_id, status,
     vendor_contact_name, vendor_contact_email, vendor_contact_title,
     addenda_generated_at, sent_to_vendor_at, vendor_responded_at, completed_at, approved_at, approved_by)
  VALUES
    (qi_001, a1, qtv_id, 'PREFILL_IN_PROGRESS',
     'Maya Khoury', 'maya.khoury@aurora-cs.example', 'Quality Director',
     '2026-04-23T11:30:00Z', NULL, NULL, NULL, NULL, NULL),
    (qi_003, a3, qtv_id, 'COMPLETE',
     'Aman Patel', 'aman.patel@patientpulse.example', 'Compliance Lead',
     '2026-04-12T09:15:00Z', '2026-04-15T13:00:00Z', '2026-04-22T16:45:00Z',
     '2026-04-25T10:20:00Z', '2026-04-26T08:30:00Z', auditor_id);

  -- Template questions (shared across all instances)
  INSERT INTO questionnaire_questions
    (id, origin, template_version_id, instance_id, question_number, section_title, section_code,
     prompt, answer_type, evidence_expected, domain_tag, ordinal)
  VALUES
    (q_t_1_1_1, 'TEMPLATE', qtv_id, NULL, '1.1.1', 'Vendor background',         '1.1', 'Provide your full registered legal name, primary office address, and country of incorporation.', 'NARRATIVE',         FALSE, NULL, 1),
    (q_t_1_1_2, 'TEMPLATE', qtv_id, NULL, '1.1.2', 'Vendor background',         '1.1', 'List all certifications and accreditations currently held (ISO, HITRUST, SOC, etc.).',           'LIST',              TRUE,  NULL, 2),
    (q_t_4_1_1, 'TEMPLATE', qtv_id, NULL, '4.1.1', 'Validation lifecycle',      '4.1', 'Describe your validation lifecycle for the contracted services.',                                'NARRATIVE',         FALSE, NULL, 3),
    (q_t_5_2_1, 'TEMPLATE', qtv_id, NULL, '5.2.1', 'Data management',           '5.2', 'Describe your data management plan and query resolution process.',                              'NARRATIVE',         FALSE, NULL, 4);

  -- Addenda (per-instance, ADDENDUM origin)
  INSERT INTO questionnaire_questions
    (id, origin, template_version_id, instance_id, question_number, section_title, section_code,
     prompt, answer_type, evidence_expected, domain_tag, ordinal, generated_from_mapping_id)
  VALUES
    (q_a_brighten_1, 'ADDENDUM', NULL, qi_001, '5.3.1', 'Service-specific (CRO)',         '5.3', 'Describe your governance for biostatistics handoffs at database lock.', 'NARRATIVE',        FALSE, 'biostats', 10, sm_001_01),
    (q_a_immune_1,   'ADDENDUM', NULL, qi_003, '5.3.1', 'Service-specific (ePRO platform)','5.3', 'Provide validation evidence for the scoring engine on the endpoint critical path.', 'EVIDENCE_REQUEST', TRUE,  'ePRO',     10, sm_003_02),
    (q_a_immune_2,   'ADDENDUM', NULL, qi_003, '5.3.2', 'Service-specific (ePRO platform)','5.3', 'Provide your device hygiene SOP and last training/refresh schedule.', 'EVIDENCE_REQUEST', TRUE,  'ePRO',     11, sm_003_03);

  -- Responses (only a few — enough to render meaningful state)
  INSERT INTO questionnaire_response_objects
    (instance_id, question_id, audit_id, response_text, response_status, source, source_reference, responded_by, responded_at)
  VALUES
    (qi_001, q_t_1_1_1, a1, 'Aurora Clinical Services Ltd, registered in the United Kingdom; primary office London with delivery centres in Bengaluru and Boston.', 'ANSWERED', 'AUDITOR_PREFILL_WEB', 'https://aurora-cs.example/about',   auditor_id, NOW()),
    (qi_001, q_t_1_1_2, a1, 'ISO 9001:2015, ISO 27001:2022, GCP-trained staff (organisation-wide).',                                                              'ANSWERED', 'AUDITOR_PREFILL_WEB', 'https://aurora-cs.example/quality', auditor_id, NOW()),
    (qi_001, q_t_4_1_1, a1, NULL, 'UNANSWERED', 'PENDING', NULL, NULL, NULL),
    (qi_001, q_t_5_2_1, a1, NULL, 'UNANSWERED', 'PENDING', NULL, NULL, NULL),
    (qi_001, q_a_brighten_1, a1, NULL, 'UNANSWERED', 'PENDING', NULL, NULL, NULL),
    -- audit-003 questionnaire is COMPLETE — all responses ANSWERED via VENDOR
    (qi_003, q_t_1_1_1, a3, 'Vendor response received and reviewed.', 'ANSWERED', 'VENDOR', NULL, auditor_id, NOW()),
    (qi_003, q_t_1_1_2, a3, 'Vendor response received and reviewed.', 'ANSWERED', 'VENDOR', NULL, auditor_id, NOW()),
    (qi_003, q_t_4_1_1, a3, 'Vendor response received and reviewed.', 'ANSWERED', 'VENDOR', NULL, auditor_id, NOW()),
    (qi_003, q_t_5_2_1, a3, 'Vendor response received and reviewed.', 'ANSWERED', 'VENDOR', NULL, auditor_id, NOW()),
    (qi_003, q_a_immune_1, a3, 'Vendor provided full response with supporting documentation; reviewed and accepted.', 'ANSWERED', 'VENDOR', NULL, auditor_id, NOW()),
    (qi_003, q_a_immune_2, a3, 'Vendor provided full response with supporting documentation; reviewed and accepted.', 'ANSWERED', 'VENDOR', NULL, auditor_id, NOW());

  -- -------------------------------------------------------------------------
  -- 11. Pre-audit deliverables (Stage 5) — audit-003 only
  -- audit-001 hasn't reached this stage; audit-002 is still in INTAKE.
  -- -------------------------------------------------------------------------
  INSERT INTO confirmation_letter_objects (id, audit_id, content, approval_status, approved_by, approved_at) VALUES
    (cl_003, a3,
     jsonb_build_object(
       'body_text', E'Thank you for your continued partnership on this study. This letter confirms the upcoming audit of your electronic patient-reported outcome platform and patient device fleet.\n\nAudit dates: 22 May 2026 – 23 May 2026 (remote pre-audit calls), with onsite engagement at your primary office on 26 May 2026.\n\nAudit scope is summarized below. Please confirm receipt and the proposed attendees from your side by reply.',
       'recipients', ARRAY['Aman Patel (Compliance Lead)','Mei Tanaka (QA Director)','patientpulse-audits@patientpulse.example'],
       'scope',      ARRAY['Platform validation evidence for the scoring engine','21 CFR Part 11 conformance — system controls + audit trail review','Device provisioning + hygiene SOPs','Outage handling and data recovery procedures']
     ),
     'APPROVED', auditor_id, '2026-04-26T14:18:00Z');

  INSERT INTO agenda_objects (id, audit_id, content, approval_status, approved_by, approved_at) VALUES
    (ag_003, a3,
     jsonb_build_object('items', jsonb_build_array(
       jsonb_build_object('id','ai-003-1','time','Day 1 · 09:00 – 09:30','topic','Opening meeting — introductions, scope confirmation','owner','Auditor + Vendor leadership','notes','Capture attendee list. Confirm any last-minute scope adjustments.'),
       jsonb_build_object('id','ai-003-2','time','Day 1 · 09:30 – 11:30','topic','Platform validation lifecycle review','owner','Vendor QA + Engineering','notes','Walk-through of validation evidence for the scoring engine on the endpoint critical path.'),
       jsonb_build_object('id','ai-003-3','time','Day 1 · 13:00 – 15:00','topic','21 CFR Part 11 controls demonstration','owner','Vendor Compliance','notes','Live demo of audit-trail capture, e-signature, and access controls.'),
       jsonb_build_object('id','ai-003-4','time','Day 2 · 09:00 – 11:00','topic','Device fleet hygiene + provisioning','owner','Vendor Operations','notes','Review SOPs, sample device chain-of-custody records.'),
       jsonb_build_object('id','ai-003-5','time','Day 2 · 14:00 – 15:00','topic','Closing meeting — preliminary observations','owner','Auditor','notes','Share verbal preliminary observations; final report follows in 30 days.')
     )),
     'APPROVED', auditor_id, '2026-04-27T10:42:00Z');

  INSERT INTO checklist_objects (id, audit_id, content, approval_status, approved_by, approved_at) VALUES
    (ch_003, a3,
     jsonb_build_object('items', jsonb_build_array(
       jsonb_build_object('id','ci-003-1','prompt','Verify platform validation master plan is current and signed.',                  'checkpoint_ref','[D-004 STUB] SOP-VAL-001 §2.3','evidence_expected', TRUE),
       jsonb_build_object('id','ci-003-2','prompt','Confirm scoring algorithm change-control records for last 12 months.',          'checkpoint_ref','[D-004 STUB] SOP-VAL-001 §4.1','evidence_expected', TRUE),
       jsonb_build_object('id','ci-003-3','prompt','Review audit trail samples for representative patient device sessions.',         'checkpoint_ref','[D-004 STUB] SOP-21CFR-002', 'evidence_expected', TRUE),
       jsonb_build_object('id','ci-003-4','prompt','Inspect device-hygiene cleaning logs from the most recent two months.',         'checkpoint_ref', NULL,                          'evidence_expected', TRUE),
       jsonb_build_object('id','ci-003-5','prompt','Walk through outage handling SOP — confirm step ownership and notifications.',  'checkpoint_ref','[D-004 STUB] SOP-OPS-014',     'evidence_expected', FALSE)
     )),
     'DRAFT', NULL, NULL);

  -- -------------------------------------------------------------------------
  -- 12. Workspace entries (Stage 6) — audit-003 sample observations
  -- -------------------------------------------------------------------------
  INSERT INTO audit_workspace_entry_objects
    (id, audit_id, protocol_risk_id, vendor_service_mapping_id, questionnaire_response_id,
     checkpoint_ref, vendor_domain, observation_text, provisional_impact, provisional_classification,
     risk_attrs_inherited, inherited_endpoint_tier, inherited_impact_surface, inherited_time_sensitivity,
     created_by)
  VALUES
    (we_003_1, a3, pr_003_01, sm_003_01, NULL,
     '[D-004 STUB] SOP-VAL-001 §2.3', 'Platform validation',
     'Validation master plan signed and current; revision history shows quarterly review cadence consistent with the SOP. No issues observed.',
     'NONE', 'NOT_YET_CLASSIFIED',
     TRUE, 'PRIMARY', 'DATA_INTEGRITY', TRUE,
     auditor_id),
    (we_003_2, a3, pr_003_02, sm_003_02, NULL,
     '[D-004 STUB] SOP-VAL-001 §4.1', 'Scoring engine change control',
     E'Last three production releases of the scoring engine include UAT sign-off and IQ/OQ documentation. One release in February shows IQ run before validation environment refresh — vendor acknowledged the sequence error and confirmed it didn''t affect production data integrity.',
     'MINOR', 'OBSERVATION',
     TRUE, 'PRIMARY', 'DATA_INTEGRITY', FALSE,
     auditor_id),
    (we_003_3, a3, NULL, NULL, NULL,
     '[D-004 STUB] SOP-OPS-014', 'Outage handling',
     'Outage handling SOP reviewed during walkthrough. Step ownership is documented but the notification matrix relies on a single individual — no documented backup contact. Vendor agreed to update the SOP within 30 days and confirm backup ownership.',
     'MAJOR', 'FINDING',
     FALSE, NULL, NULL, NULL,
     auditor_id);

  RETURN 'seeded 3 audits, 10 protocol risks, 2 vendor services, 8 service mappings, '
      || '2 trust assessments, 2 risk summaries, 2 questionnaires, 3 pre-audit deliverables, 3 workspace entries';
END;
$$;

COMMENT ON FUNCTION seed_audit_mock_data(UUID, TEXT) IS
  'Dev seed: populates 3 representative audits across stages. SECURITY DEFINER, idempotent. '
  'Call once from the SQL editor as the signed-in auditor: '
  'select seed_audit_mock_data(auth.uid(), ''Your Name'');';
