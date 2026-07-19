-- =============================================================================
-- Audit Mode — ISA notes pad schema (S1 of the notes → findings → report arc)
--
-- audit_note_objects — freeform fieldwork notes captured during an
-- Investigator Site Audit (ISA_CONDUCT pad). Notes are WORKING PAPERS, not
-- findings: unlike audit_workspace_entry_objects they are freely editable and
-- deletable by the auditor. Two deliberate deviations from the findings model:
--
--   * Soft delete only (deleted_at). Hard DELETE would orphan the note's
--     state_history_deltas — audit_mode_can_view_tracked_object resolves
--     readability by joining through the object row, so a vanished row makes
--     its trail unreadable. Soft delete also future-proofs S2: findings will
--     cite note ids as their evidence trail, and evidence must not be
--     hard-deletable out from under an accepted finding.
--
--   * isa_domain is nullable freetext-free tagging. The 15-value enum is the
--     site-audit analogue of the vendor lane's vendor_domain, derived from
--     the founder's report templates (see plans/fable/
--     isa-notes-finder-writer — S0 writing contract). Tagging is optional at
--     capture time; the S2 finding writer infers a domain when absent.
--
-- Data handling: note bodies are auditor freetext. UI guidance instructs
-- subject numbers only — no participant names, initials, or DOBs. Bodies stay
-- in Postgres in S1; the S2 migration documents the LLM data-handling stance
-- before any note text leaves the database (mirroring 20260516010000).
-- =============================================================================

-- Site-audit observation domains (S0 writing contract, SAMPLE_2 category
-- matrix ∪ SAMPLE_1/3 category pairs).
CREATE TYPE isa_domain AS ENUM (
  'INFORMED_CONSENT',
  'INVESTIGATOR_OVERSIGHT_DELEGATION',
  'INVESTIGATIONAL_PRODUCT',
  'SAFETY_AE_SAE',
  'SOURCE_DATA_VERIFICATION',
  'RECORDKEEPING_SOURCE_DOCS',
  'ESSENTIAL_DOCUMENTS',
  'IRB_EC',
  'STAFF_QUALIFICATIONS_TRAINING',
  'FACILITIES_EQUIPMENT',
  'ELECTRONIC_SYSTEMS',
  'STUDY_CONDUCT_GCP',
  'CLINICAL_MONITORING',
  'SOP_REVIEW',
  'OTHER'
);

-- New tracked type for state-history deltas. The RPC migration that follows
-- (20260723000100) extends audit_mode_can_view_tracked_object with the
-- matching branch.
ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'AUDIT_NOTE_OBJECT';

CREATE TABLE audit_note_objects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id    UUID        NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  body        TEXT        NOT NULL,
  isa_domain  isa_domain,
  is_positive BOOLEAN     NOT NULL DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,
  created_by  UUID        NOT NULL REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The pad always queries live notes for one audit, newest first.
CREATE INDEX idx_audit_note_objects_audit_live
  ON audit_note_objects (audit_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER touch_audit_note_objects_updated_at
  BEFORE UPDATE ON audit_note_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- Single-owner RLS, uniform with every audit-scoped table (phase-1 pattern).
ALTER TABLE audit_note_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_note_objects_via_audit"
  ON audit_note_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));
