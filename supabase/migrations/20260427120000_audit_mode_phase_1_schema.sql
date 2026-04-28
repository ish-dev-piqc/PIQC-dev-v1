-- =============================================================================
-- Audit Mode (Vendor PIQC) — Phase 1 schema
-- Ported from rv1_code/prisma/schema.prisma. Source of truth for the audit
-- workflow: 25 tables, 26 enums, polymorphic state-delta audit trail.
--
-- Ground rules (carried from source schema):
--   - Schema-first, relational. No text blobs for structured reasoning.
--   - All risk/trust/classification changes write StateHistoryDelta rows.
--   - No autonomous finding finalization. No black-box scoring.
--   - Sponsor name never appears in any system-generated text.
--   - Evidence is always linked to structured objects, never loose files.
--
-- Stubs preserved for open decisions:
--   [PIQC]       — D-009 (PIQC API contract) — piqc_protocol_id + raw_piqc_payload
--   [D-005]      — Trust posture scoring model (qualitative enums for now)
--   [D-004 STUB] — checkpoint_ref is plain text until SOP parsing lands
--   [D-007]      — Evidence attachment model (basic file + metadata for now)
--
-- Auth integration: actor identity uses Supabase auth.users(id) directly.
-- A small public.user_profiles table holds name + role.
-- RLS policies are in the companion migration.
-- =============================================================================


-- =============================================================================
-- ENUMS (26)
-- =============================================================================

CREATE TYPE user_role AS ENUM ('AUDITOR', 'LEAD_AUDITOR', 'OBSERVER');

CREATE TYPE protocol_version_status AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- Clinical trial study phase. Drives questionnaire scrutiny depth.
CREATE TYPE clinical_trial_phase AS ENUM (
  'PHASE_1', 'PHASE_1_2', 'PHASE_2', 'PHASE_2_3',
  'PHASE_3', 'PHASE_4', 'NOT_APPLICABLE'
);

CREATE TYPE endpoint_tier AS ENUM ('PRIMARY', 'SECONDARY', 'SAFETY', 'SUPPORTIVE');

CREATE TYPE impact_surface AS ENUM ('DATA_INTEGRITY', 'PATIENT_SAFETY', 'BOTH');

CREATE TYPE version_change_type AS ENUM ('ADDED', 'MODIFIED', 'UNCHANGED');

CREATE TYPE audit_type AS ENUM ('REMOTE', 'ONSITE', 'HYBRID');

CREATE TYPE audit_status AS ENUM ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'CLOSED');

-- D-010: Authoritative workflow position for an Audit.
CREATE TYPE audit_stage AS ENUM (
  'INTAKE',
  'VENDOR_ENRICHMENT',
  'QUESTIONNAIRE_REVIEW',
  'SCOPE_AND_RISK_REVIEW',
  'PRE_AUDIT_DRAFTING',
  'AUDIT_CONDUCT',
  'REPORT_DRAFTING',
  'FINAL_REVIEW_EXPORT'
);

CREATE TYPE risk_summary_approval_status AS ENUM ('DRAFT', 'APPROVED');

CREATE TYPE deliverable_approval_status AS ENUM ('DRAFT', 'APPROVED');

CREATE TYPE derived_criticality AS ENUM ('CRITICAL', 'HIGH', 'MODERATE', 'LOW');

-- [D-005] qualitative posture enums — may be replaced once decided.
CREATE TYPE compliance_posture AS ENUM ('STRONG', 'ADEQUATE', 'WEAK', 'UNKNOWN');
CREATE TYPE maturity_posture   AS ENUM ('MATURE', 'DEVELOPING', 'EARLY', 'UNKNOWN');
CREATE TYPE trust_posture      AS ENUM ('HIGH', 'MODERATE', 'LOW', 'UNKNOWN');

CREATE TYPE response_status AS ENUM ('ANSWERED', 'UNANSWERED', 'PARTIAL', 'DEFERRED');

CREATE TYPE question_answer_type AS ENUM (
  'NARRATIVE', 'YES_NO_QUALIFY', 'EVIDENCE_REQUEST', 'LIST', 'NUMERIC'
);

CREATE TYPE response_source AS ENUM (
  'PENDING',
  'AUDITOR_PREFILL_WEB',
  'AUDITOR_PREFILL_PRIOR_AUDIT',
  'AUDITOR_AUTHORED',
  'VENDOR',
  'NOT_APPLICABLE'
);

CREATE TYPE questionnaire_instance_status AS ENUM (
  'DRAFT',
  'PREFILL_IN_PROGRESS',
  'READY_TO_SEND',
  'SENT_TO_VENDOR',
  'VENDOR_RESPONDED',
  'COMPLETE'
);

CREATE TYPE question_origin AS ENUM ('TEMPLATE', 'ADDENDUM');

CREATE TYPE provisional_impact AS ENUM ('CRITICAL', 'MAJOR', 'MINOR', 'OBSERVATION', 'NONE');

CREATE TYPE provisional_classification AS ENUM (
  'FINDING', 'OBSERVATION', 'OPPORTUNITY_FOR_IMPROVEMENT', 'NOT_YET_CLASSIFIED'
);

CREATE TYPE amendment_alert_status AS ENUM ('PENDING', 'REVIEWED', 'ADOPTED', 'DISMISSED');

CREATE TYPE amendment_decision AS ENUM ('ADOPT_NEW_VERSION', 'STAY_ON_CURRENT');

CREATE TYPE tagging_mode AS ENUM ('MANUAL', 'PIQC_ASSISTED', 'LLM_ASSISTED');

-- Polymorphic discriminator for state_history_deltas. Each value maps 1:1 to a table.
CREATE TYPE tracked_object_type AS ENUM (
  'PROTOCOL_RISK_OBJECT',
  'VENDOR_SERVICE_OBJECT',
  'VENDOR_SERVICE_MAPPING_OBJECT',
  'TRUST_ASSESSMENT_OBJECT',
  'QUESTIONNAIRE_INSTANCE',
  'QUESTIONNAIRE_RESPONSE_OBJECT',
  'AUDIT_WORKSPACE_ENTRY_OBJECT',
  'AUDIT',
  'AMENDMENT_ALERT',
  'VENDOR_RISK_SUMMARY_OBJECT',
  'CONFIRMATION_LETTER_OBJECT',
  'AGENDA_OBJECT',
  'CHECKLIST_OBJECT'
);


-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Bumps updated_at on row UPDATE. Attached as a trigger to every table that
-- has an updated_at column.
CREATE OR REPLACE FUNCTION audit_mode_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- =============================================================================
-- USER PROFILES
-- Wraps Supabase auth.users with display name + audit role. id mirrors
-- auth.users.id 1:1. App layer creates the profile on first sign-in.
-- =============================================================================

CREATE TABLE user_profiles (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  role       user_role   NOT NULL DEFAULT 'AUDITOR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();


-- =============================================================================
-- REFERENCE TABLES
-- Globally readable to authenticated users; written by service role for now.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Vendor — root entity (D-006). Persists across audits.
-- -----------------------------------------------------------------------------
CREATE TABLE vendors (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  legal_name TEXT,
  country    TEXT        NOT NULL,
  website    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Protocol — stable trial identity. Never mutated after creation.
-- Amendments create new ProtocolVersion rows.
-- -----------------------------------------------------------------------------
CREATE TABLE protocols (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_number TEXT        UNIQUE,         -- NCT, EudraCT, etc. Stable across amendments.
  title        TEXT        NOT NULL,
  sponsor      TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_protocols_updated_at
  BEFORE UPDATE ON protocols
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- ProtocolVersion — one version of a protocol. Created from PIQC payloads.
-- [PIQC] D-009: piqc_protocol_id + raw_piqc_payload formats TBD.
-- -----------------------------------------------------------------------------
CREATE TABLE protocol_versions (
  id                   UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id          UUID                    NOT NULL REFERENCES protocols(id),
  version_number       INTEGER                 NOT NULL,
  amendment_label      TEXT,
  status               protocol_version_status NOT NULL DEFAULT 'DRAFT',
  effective_date       DATE,
  clinical_trial_phase clinical_trial_phase    NOT NULL DEFAULT 'NOT_APPLICABLE',
  piqc_protocol_id     TEXT                    NOT NULL,  -- [PIQC] format TBD
  raw_piqc_payload     JSONB                   NOT NULL,  -- [PIQC] full payload for traceability only
  received_at          TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  UNIQUE (protocol_id, version_number)
);

-- -----------------------------------------------------------------------------
-- ProtocolRiskObject — risk-tagged section of a ProtocolVersion.
-- Lineage tracking via previous_version_risk_id for amendment diffs.
-- -----------------------------------------------------------------------------
CREATE TABLE protocol_risk_objects (
  id                       UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_version_id      UUID                NOT NULL REFERENCES protocol_versions(id),
  section_identifier       TEXT                NOT NULL,  -- [PIQC] format TBD
  section_title            TEXT                NOT NULL,
  endpoint_tier            endpoint_tier       NOT NULL,
  impact_surface           impact_surface      NOT NULL,
  time_sensitivity         BOOLEAN             NOT NULL,
  vendor_dependency_flags  TEXT[]              NOT NULL DEFAULT '{}',
  operational_domain_tag   TEXT                NOT NULL,  -- ECG | imaging | ePRO | randomization | central_lab | IVRS
  tagging_mode             tagging_mode        NOT NULL DEFAULT 'MANUAL',
  suggestion_provenance    JSONB,
  previous_version_risk_id UUID                REFERENCES protocol_risk_objects(id),
  version_change_type      version_change_type NOT NULL,
  tagged_by                UUID                NOT NULL REFERENCES auth.users(id),
  tagged_at                TIMESTAMPTZ         NOT NULL,
  created_at               TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_protocol_risk_objects_version ON protocol_risk_objects(protocol_version_id);

CREATE TRIGGER touch_protocol_risk_objects_updated_at
  BEFORE UPDATE ON protocol_risk_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- QuestionnaireTemplate — canonical reusable definition (D-003).
-- -----------------------------------------------------------------------------
CREATE TABLE questionnaire_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  description TEXT,
  is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_questionnaire_templates_updated_at
  BEFORE UPDATE ON questionnaire_templates
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- QuestionnaireTemplateVersion — immutable version of a template.
-- -----------------------------------------------------------------------------
CREATE TABLE questionnaire_template_versions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    UUID        NOT NULL REFERENCES questionnaire_templates(id),
  version_number INTEGER     NOT NULL,
  notes          TEXT,
  published_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, version_number)
);


-- =============================================================================
-- AUDIT-SCOPED TABLES
-- Per-audit data. Visibility scoped to Audit.lead_auditor_id (RLS migration).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Audit — engagement scoped to one Vendor + ProtocolVersion + service.
-- D-010: current_stage drives navigation/gating; status is a coarse health flag.
-- -----------------------------------------------------------------------------
CREATE TABLE audits (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id           UUID         NOT NULL REFERENCES vendors(id),
  protocol_id         UUID         NOT NULL REFERENCES protocols(id),
  protocol_version_id UUID         NOT NULL REFERENCES protocol_versions(id),
  audit_name          TEXT         NOT NULL,
  audit_type          audit_type   NOT NULL,
  status              audit_status NOT NULL DEFAULT 'DRAFT',
  current_stage       audit_stage  NOT NULL DEFAULT 'INTAKE',
  lead_auditor_id     UUID         NOT NULL REFERENCES auth.users(id),
  scheduled_date      DATE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audits_vendor          ON audits(vendor_id);
CREATE INDEX idx_audits_protocol_version ON audits(protocol_version_id);
CREATE INDEX idx_audits_lead_auditor    ON audits(lead_auditor_id);

CREATE TRIGGER touch_audits_updated_at
  BEFORE UPDATE ON audits
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- VendorServiceObject — the specific vendor service under audit (1:1 with Audit).
-- -----------------------------------------------------------------------------
CREATE TABLE vendor_service_objects (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id            UUID        NOT NULL UNIQUE REFERENCES audits(id),
  service_name        TEXT        NOT NULL,
  service_type        TEXT        NOT NULL,    -- ECG | central_lab | ePRO | IVRS | imaging | randomization
  service_description TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_vendor_service_objects_updated_at
  BEFORE UPDATE ON vendor_service_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- VendorServiceMappingObject — first-class junction with derived criticality.
-- -----------------------------------------------------------------------------
CREATE TABLE vendor_service_mapping_objects (
  id                    UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_service_id     UUID                NOT NULL REFERENCES vendor_service_objects(id),
  protocol_risk_id      UUID                NOT NULL REFERENCES protocol_risk_objects(id),
  derived_criticality   derived_criticality NOT NULL,
  criticality_rationale TEXT,
  created_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  UNIQUE (vendor_service_id, protocol_risk_id)
);

CREATE TRIGGER touch_vendor_service_mapping_objects_updated_at
  BEFORE UPDATE ON vendor_service_mapping_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- TrustAssessmentObject — front-end vendor intelligence (1:1 with Audit).
-- [D-005] qualitative posture enums.
-- -----------------------------------------------------------------------------
CREATE TABLE trust_assessment_objects (
  id                        UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id                  UUID                NOT NULL UNIQUE REFERENCES audits(id),
  certifications_claimed    TEXT[]              NOT NULL DEFAULT '{}',
  regulatory_claims         TEXT[]              NOT NULL DEFAULT '{}',
  compliance_posture        compliance_posture  NOT NULL,
  maturity_posture          maturity_posture    NOT NULL,
  provisional_trust_posture trust_posture       NOT NULL,
  risk_hypotheses           TEXT[]              NOT NULL DEFAULT '{}',
  notes                     TEXT,
  assessed_by               UUID                NOT NULL REFERENCES auth.users(id),
  assessed_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_trust_assessment_objects_updated_at
  BEFORE UPDATE ON trust_assessment_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- VendorRiskSummaryObject (D-010) — secondary decision layer (1:1 with Audit).
-- study_context is a snapshot, not a live FK read. Stable across amendments.
-- -----------------------------------------------------------------------------
CREATE TABLE vendor_risk_summary_objects (
  id                         UUID                         PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id                   UUID                         NOT NULL UNIQUE REFERENCES audits(id),
  study_context              JSONB                        NOT NULL,    -- snapshot of therapeutic space, endpoints, phase
  vendor_relevance_narrative TEXT                         NOT NULL,
  focus_areas                TEXT[]                       NOT NULL DEFAULT '{}',
  approval_status            risk_summary_approval_status NOT NULL DEFAULT 'DRAFT',
  approved_at                TIMESTAMPTZ,
  approved_by                UUID                         REFERENCES auth.users(id),
  created_at                 TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ                  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_vendor_risk_summary_objects_updated_at
  BEFORE UPDATE ON vendor_risk_summary_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- VendorRiskSummary ↔ ProtocolRisk (many-to-many junction).
-- -----------------------------------------------------------------------------
CREATE TABLE vendor_risk_summary_protocol_risks (
  risk_summary_id  UUID NOT NULL REFERENCES vendor_risk_summary_objects(id),
  protocol_risk_id UUID NOT NULL REFERENCES protocol_risk_objects(id),
  PRIMARY KEY (risk_summary_id, protocol_risk_id)
);

-- -----------------------------------------------------------------------------
-- QuestionnaireInstance (D-003) — one per Audit. Forks from a template version.
-- -----------------------------------------------------------------------------
CREATE TABLE questionnaire_instances (
  id                    UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id              UUID                          NOT NULL UNIQUE REFERENCES audits(id),
  template_version_id   UUID                          NOT NULL REFERENCES questionnaire_template_versions(id),
  status                questionnaire_instance_status NOT NULL DEFAULT 'DRAFT',
  vendor_contact_name   TEXT,
  vendor_contact_email  TEXT,
  vendor_contact_title  TEXT,
  addenda_generated_at  TIMESTAMPTZ,
  sent_to_vendor_at     TIMESTAMPTZ,
  vendor_responded_at   TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  approved_at           TIMESTAMPTZ,
  approved_by           UUID                          REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ                   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_questionnaire_instances_template ON questionnaire_instances(template_version_id);

CREATE TRIGGER touch_questionnaire_instances_updated_at
  BEFORE UPDATE ON questionnaire_instances
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- QuestionnaireQuestion — TEMPLATE-origin OR ADDENDUM-origin.
-- App invariant: exactly one of (template_version_id, instance_id) is non-null.
-- -----------------------------------------------------------------------------
CREATE TABLE questionnaire_questions (
  id                        UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  origin                    question_origin      NOT NULL,
  template_version_id       UUID                 REFERENCES questionnaire_template_versions(id),
  instance_id               UUID                 REFERENCES questionnaire_instances(id),
  question_number           TEXT                 NOT NULL,
  section_title             TEXT                 NOT NULL,
  section_code              TEXT                 NOT NULL,
  prompt                    TEXT                 NOT NULL,
  answer_type               question_answer_type NOT NULL,
  evidence_expected         BOOLEAN              NOT NULL DEFAULT FALSE,
  domain_tag                TEXT,
  generated_from_mapping_id UUID                 REFERENCES vendor_service_mapping_objects(id),
  ordinal                   INTEGER              NOT NULL,
  created_at                TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  -- Enforce exactly-one parent at DB level too:
  CHECK (
    (origin = 'TEMPLATE' AND template_version_id IS NOT NULL AND instance_id IS NULL)
    OR
    (origin = 'ADDENDUM' AND template_version_id IS NULL AND instance_id IS NOT NULL)
  )
);

CREATE INDEX idx_questionnaire_questions_template_version ON questionnaire_questions(template_version_id);
CREATE INDEX idx_questionnaire_questions_instance         ON questionnaire_questions(instance_id);

-- -----------------------------------------------------------------------------
-- QuestionnaireResponseObject — one row per (instance, question).
-- audit_id is denormalized for fast per-audit queries and RLS lookups.
-- -----------------------------------------------------------------------------
CREATE TABLE questionnaire_response_objects (
  id                        UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id               UUID            NOT NULL REFERENCES questionnaire_instances(id),
  question_id               UUID            NOT NULL REFERENCES questionnaire_questions(id),
  audit_id                  UUID            NOT NULL REFERENCES audits(id),
  vendor_service_mapping_id UUID            REFERENCES vendor_service_mapping_objects(id),
  response_text             TEXT,
  response_status           response_status NOT NULL DEFAULT 'UNANSWERED',
  source                    response_source NOT NULL DEFAULT 'PENDING',
  source_reference          TEXT,
  confidence_flag           BOOLEAN         NOT NULL DEFAULT FALSE,
  inconsistency_flag        BOOLEAN         NOT NULL DEFAULT FALSE,
  inconsistency_note        TEXT,
  responded_by              UUID            REFERENCES auth.users(id),
  responded_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (instance_id, question_id)
);

CREATE INDEX idx_questionnaire_responses_audit          ON questionnaire_response_objects(audit_id);
CREATE INDEX idx_questionnaire_responses_instance_source ON questionnaire_response_objects(instance_id, source);

CREATE TRIGGER touch_questionnaire_response_objects_updated_at
  BEFORE UPDATE ON questionnaire_response_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- AuditWorkspaceEntryObject — structured auditor observation.
-- Risk attrs are COPIED at link time, not read live. risk_context_outdated is
-- system-written when a linked ProtocolRiskObject changes via amendment.
-- -----------------------------------------------------------------------------
CREATE TABLE audit_workspace_entry_objects (
  id                          UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id                    UUID                       NOT NULL REFERENCES audits(id),
  protocol_risk_id            UUID                       REFERENCES protocol_risk_objects(id),
  vendor_service_mapping_id   UUID                       REFERENCES vendor_service_mapping_objects(id),
  questionnaire_response_id   UUID                       REFERENCES questionnaire_response_objects(id),
  checkpoint_ref              TEXT,                      -- [D-004 STUB] plain text until SOP parsing
  vendor_domain               TEXT                       NOT NULL,
  observation_text            TEXT                       NOT NULL,
  provisional_impact          provisional_impact         NOT NULL DEFAULT 'NONE',
  provisional_classification  provisional_classification NOT NULL DEFAULT 'NOT_YET_CLASSIFIED',
  risk_attrs_inherited        BOOLEAN                    NOT NULL DEFAULT FALSE,
  inherited_endpoint_tier     endpoint_tier,
  inherited_impact_surface    impact_surface,
  inherited_time_sensitivity  BOOLEAN,
  risk_context_outdated       BOOLEAN                    NOT NULL DEFAULT FALSE,
  risk_context_confirmed_at   TIMESTAMPTZ,
  risk_context_confirmed_by   UUID                       REFERENCES auth.users(id),
  created_by                  UUID                       NOT NULL REFERENCES auth.users(id),
  created_at                  TIMESTAMPTZ                NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ                NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workspace_entries_audit             ON audit_workspace_entry_objects(audit_id);
CREATE INDEX idx_workspace_entries_outdated          ON audit_workspace_entry_objects(risk_context_outdated);

CREATE TRIGGER touch_audit_workspace_entry_objects_updated_at
  BEFORE UPDATE ON audit_workspace_entry_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- AmendmentAlert — created when a new ProtocolVersion is ingested.
-- -----------------------------------------------------------------------------
CREATE TABLE amendment_alerts (
  id              UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        UUID                   NOT NULL REFERENCES audits(id),
  from_version_id UUID                   NOT NULL REFERENCES protocol_versions(id),
  to_version_id   UUID                   NOT NULL REFERENCES protocol_versions(id),
  status          amendment_alert_status NOT NULL DEFAULT 'PENDING',
  decision        amendment_decision,
  decision_note   TEXT,
  reviewed_by     UUID                   REFERENCES auth.users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ            NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_amendment_alerts_audit_status ON amendment_alerts(audit_id, status);

CREATE TRIGGER touch_amendment_alerts_updated_at
  BEFORE UPDATE ON amendment_alerts
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- EvidenceAttachment + junctions.
-- [D-007] Phase 1: file metadata only. Phase 2 layers versioning on top.
-- -----------------------------------------------------------------------------
CREATE TABLE evidence_attachments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  filename        TEXT        NOT NULL,
  storage_key     TEXT        NOT NULL,    -- Supabase Storage object key
  mime_type       TEXT        NOT NULL,
  file_size_bytes INTEGER     NOT NULL,
  checkpoint_ref  TEXT,
  uploaded_by     UUID        NOT NULL REFERENCES auth.users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE evidence_on_workspace_entries (
  workspace_entry_id UUID NOT NULL REFERENCES audit_workspace_entry_objects(id),
  evidence_id        UUID NOT NULL REFERENCES evidence_attachments(id),
  PRIMARY KEY (workspace_entry_id, evidence_id)
);

CREATE TABLE evidence_on_questionnaire_responses (
  questionnaire_response_id UUID NOT NULL REFERENCES questionnaire_response_objects(id),
  evidence_id               UUID NOT NULL REFERENCES evidence_attachments(id),
  PRIMARY KEY (questionnaire_response_id, evidence_id)
);

-- -----------------------------------------------------------------------------
-- Pre-Audit Drafting deliverables (D-010 step 7).
-- Three 1:1 deliverables sharing the same shape. content is JSONB scaffolding.
-- -----------------------------------------------------------------------------
CREATE TABLE confirmation_letter_objects (
  id              UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        UUID                        NOT NULL UNIQUE REFERENCES audits(id),
  content         JSONB                       NOT NULL DEFAULT '{}'::jsonb,
  approval_status deliverable_approval_status NOT NULL DEFAULT 'DRAFT',
  approved_by     UUID                        REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_confirmation_letter_objects_updated_at
  BEFORE UPDATE ON confirmation_letter_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

CREATE TABLE agenda_objects (
  id              UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        UUID                        NOT NULL UNIQUE REFERENCES audits(id),
  content         JSONB                       NOT NULL DEFAULT '{}'::jsonb,
  approval_status deliverable_approval_status NOT NULL DEFAULT 'DRAFT',
  approved_by     UUID                        REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_agenda_objects_updated_at
  BEFORE UPDATE ON agenda_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

CREATE TABLE checklist_objects (
  id              UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        UUID                        NOT NULL UNIQUE REFERENCES audits(id),
  content         JSONB                       NOT NULL DEFAULT '{}'::jsonb,
  approval_status deliverable_approval_status NOT NULL DEFAULT 'DRAFT',
  approved_by     UUID                        REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_checklist_objects_updated_at
  BEFORE UPDATE ON checklist_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();


-- =============================================================================
-- STATE HISTORY
-- Append-only polymorphic audit trail. NEVER UPDATE OR DELETE rows here.
-- Application code routes all mutations through wrapping RPCs that insert here
-- in the same transaction as the underlying object mutation.
-- =============================================================================

CREATE TABLE state_history_deltas (
  id             UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type    tracked_object_type NOT NULL,
  object_id      UUID                NOT NULL,    -- Polymorphic — no DB FK
  changed_fields JSONB               NOT NULL,    -- { fieldName: { from, to } }
  actor_id       UUID                NOT NULL REFERENCES auth.users(id),
  reason         TEXT,
  created_at     TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_state_history_object ON state_history_deltas(object_type, object_id);
CREATE INDEX idx_state_history_actor  ON state_history_deltas(actor_id);
