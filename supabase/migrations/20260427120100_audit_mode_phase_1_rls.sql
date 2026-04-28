-- =============================================================================
-- Audit Mode (Vendor PIQC) — Phase 1 row-level security
--
-- Visibility model (per Kiara's sign-off, Decision 2 = Option C):
--
--   REFERENCE TABLES — readable by any authenticated user; writes by service role
--     vendors, protocols, protocol_versions, protocol_risk_objects,
--     questionnaire_templates, questionnaire_template_versions,
--     questionnaire_questions
--
--   AUDIT-SCOPED TABLES — visible to audits.lead_auditor_id only
--     audits, vendor_service_objects, vendor_service_mapping_objects,
--     trust_assessment_objects, vendor_risk_summary_objects,
--     vendor_risk_summary_protocol_risks, questionnaire_instances,
--     questionnaire_response_objects, audit_workspace_entry_objects,
--     amendment_alerts, evidence_attachments, evidence junctions,
--     confirmation_letter_objects, agenda_objects, checklist_objects
--
--   AUDIT TRAIL — visible if the underlying object is visible (polymorphic)
--     state_history_deltas
--
--   USER PROFILES — anyone authenticated can read (so we can show actor names);
--     a user can update only their own row
--
-- Future expansion (no schema change required):
--   - Add audit_members(audit_id, user_id, role) → broaden to "lead OR member"
--   - Add organizations + org_members → broaden to "anyone in the audit's org"
--   - Add admin role check via user_profiles.role = 'admin'
--
-- Performance note: child-table policies do an IN (SELECT ...) lookup against
-- audits. Acceptable at the small-team scale described in the UX docs ("~2
-- audits/month/auditor"). If scale grows we'll denormalize lead_auditor_id
-- onto child tables. Don't optimize until perf bites.
-- =============================================================================


-- =============================================================================
-- HELPER: polymorphic visibility check for state_history_deltas
-- =============================================================================

-- Returns true if the calling user (auth.uid()) can see the object identified
-- by (obj_type, obj_id). Encodes the same scoping rules as the per-table RLS
-- policies below, but in one place so state_history_deltas can dispatch on
-- object type. SECURITY DEFINER so the function reads past RLS on the lookup
-- tables — needed because RLS would otherwise hide the row we're checking.
-- STABLE because it gives the same answer within a statement.
CREATE OR REPLACE FUNCTION audit_mode_can_view_tracked_object(
  obj_type tracked_object_type,
  obj_id   UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Reference data — globally visible to authenticated users.
  IF obj_type = 'PROTOCOL_RISK_OBJECT' THEN
    RETURN TRUE;
  END IF;

  -- Audit and audit-scoped objects — visible to the audit's lead auditor.
  IF obj_type = 'AUDIT' THEN
    SELECT lead_auditor_id INTO v_lead FROM audits WHERE id = obj_id;
  ELSIF obj_type = 'VENDOR_SERVICE_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM vendor_service_objects vs
      JOIN audits a ON a.id = vs.audit_id
     WHERE vs.id = obj_id;
  ELSIF obj_type = 'VENDOR_SERVICE_MAPPING_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM vendor_service_mapping_objects vm
      JOIN vendor_service_objects vs ON vs.id = vm.vendor_service_id
      JOIN audits a ON a.id = vs.audit_id
     WHERE vm.id = obj_id;
  ELSIF obj_type = 'TRUST_ASSESSMENT_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM trust_assessment_objects t
      JOIN audits a ON a.id = t.audit_id
     WHERE t.id = obj_id;
  ELSIF obj_type = 'VENDOR_RISK_SUMMARY_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM vendor_risk_summary_objects r
      JOIN audits a ON a.id = r.audit_id
     WHERE r.id = obj_id;
  ELSIF obj_type = 'QUESTIONNAIRE_INSTANCE' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM questionnaire_instances qi
      JOIN audits a ON a.id = qi.audit_id
     WHERE qi.id = obj_id;
  ELSIF obj_type = 'QUESTIONNAIRE_RESPONSE_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM questionnaire_response_objects qr
      JOIN audits a ON a.id = qr.audit_id
     WHERE qr.id = obj_id;
  ELSIF obj_type = 'AUDIT_WORKSPACE_ENTRY_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM audit_workspace_entry_objects we
      JOIN audits a ON a.id = we.audit_id
     WHERE we.id = obj_id;
  ELSIF obj_type = 'AMENDMENT_ALERT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM amendment_alerts al
      JOIN audits a ON a.id = al.audit_id
     WHERE al.id = obj_id;
  ELSIF obj_type = 'CONFIRMATION_LETTER_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM confirmation_letter_objects cl
      JOIN audits a ON a.id = cl.audit_id
     WHERE cl.id = obj_id;
  ELSIF obj_type = 'AGENDA_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM agenda_objects ag
      JOIN audits a ON a.id = ag.audit_id
     WHERE ag.id = obj_id;
  ELSIF obj_type = 'CHECKLIST_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM checklist_objects ch
      JOIN audits a ON a.id = ch.audit_id
     WHERE ch.id = obj_id;
  ELSE
    RETURN FALSE;
  END IF;

  RETURN v_lead IS NOT NULL AND v_lead = auth.uid();
END;
$$;


-- =============================================================================
-- USER PROFILES
-- =============================================================================

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read profiles (so we can render actor names on history).
CREATE POLICY "user_profiles_select_authenticated"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (TRUE);

-- A user can insert their own profile (typically on first sign-in).
CREATE POLICY "user_profiles_insert_self"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- A user can update only their own profile.
CREATE POLICY "user_profiles_update_self"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- =============================================================================
-- REFERENCE TABLES
-- Read by any authenticated user; writes only via service role.
-- =============================================================================

ALTER TABLE vendors                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocols                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocol_versions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocol_risk_objects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaire_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaire_template_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaire_questions          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendors_select_authenticated"                         ON vendors                         FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "protocols_select_authenticated"                       ON protocols                       FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "protocol_versions_select_authenticated"               ON protocol_versions               FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "protocol_risk_objects_select_authenticated"           ON protocol_risk_objects           FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "questionnaire_templates_select_authenticated"         ON questionnaire_templates         FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "questionnaire_template_versions_select_authenticated" ON questionnaire_template_versions FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "questionnaire_questions_select_authenticated"         ON questionnaire_questions         FOR SELECT TO authenticated USING (TRUE);

-- No INSERT/UPDATE/DELETE policies on reference tables → service role only.


-- =============================================================================
-- AUDITS
-- Lead auditor sees their own audits. Self-insert (creator becomes lead).
-- No DELETE policy — audits are GxP records.
-- =============================================================================

ALTER TABLE audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audits_select_lead_auditor"
  ON audits FOR SELECT
  TO authenticated
  USING (lead_auditor_id = auth.uid());

CREATE POLICY "audits_insert_self_as_lead"
  ON audits FOR INSERT
  TO authenticated
  WITH CHECK (lead_auditor_id = auth.uid());

CREATE POLICY "audits_update_lead_auditor"
  ON audits FOR UPDATE
  TO authenticated
  USING (lead_auditor_id = auth.uid())
  WITH CHECK (lead_auditor_id = auth.uid());


-- =============================================================================
-- AUDIT-SCOPED CHILD TABLES
-- Child rows are visible/writable iff the parent audit is visible to the user.
-- =============================================================================

-- Reusable predicate for "the audit_id column points to an audit I can see":
-- audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid())

ALTER TABLE vendor_service_objects             ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendor_service_objects_via_audit"
  ON vendor_service_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));

ALTER TABLE vendor_service_mapping_objects     ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendor_service_mapping_objects_via_audit"
  ON vendor_service_mapping_objects FOR ALL
  TO authenticated
  USING (
    vendor_service_id IN (
      SELECT vs.id FROM vendor_service_objects vs
      JOIN audits a ON a.id = vs.audit_id
      WHERE a.lead_auditor_id = auth.uid()
    )
  )
  WITH CHECK (
    vendor_service_id IN (
      SELECT vs.id FROM vendor_service_objects vs
      JOIN audits a ON a.id = vs.audit_id
      WHERE a.lead_auditor_id = auth.uid()
    )
  );

ALTER TABLE trust_assessment_objects           ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trust_assessment_objects_via_audit"
  ON trust_assessment_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));

ALTER TABLE vendor_risk_summary_objects        ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendor_risk_summary_objects_via_audit"
  ON vendor_risk_summary_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));

ALTER TABLE vendor_risk_summary_protocol_risks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendor_risk_summary_protocol_risks_via_audit"
  ON vendor_risk_summary_protocol_risks FOR ALL
  TO authenticated
  USING (
    risk_summary_id IN (
      SELECT r.id FROM vendor_risk_summary_objects r
      JOIN audits a ON a.id = r.audit_id
      WHERE a.lead_auditor_id = auth.uid()
    )
  )
  WITH CHECK (
    risk_summary_id IN (
      SELECT r.id FROM vendor_risk_summary_objects r
      JOIN audits a ON a.id = r.audit_id
      WHERE a.lead_auditor_id = auth.uid()
    )
  );

ALTER TABLE questionnaire_instances            ENABLE ROW LEVEL SECURITY;
CREATE POLICY "questionnaire_instances_via_audit"
  ON questionnaire_instances FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));

ALTER TABLE questionnaire_response_objects     ENABLE ROW LEVEL SECURITY;
CREATE POLICY "questionnaire_response_objects_via_audit"
  ON questionnaire_response_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));

ALTER TABLE audit_workspace_entry_objects      ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_workspace_entry_objects_via_audit"
  ON audit_workspace_entry_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));

ALTER TABLE amendment_alerts                   ENABLE ROW LEVEL SECURITY;
CREATE POLICY "amendment_alerts_via_audit"
  ON amendment_alerts FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));

ALTER TABLE confirmation_letter_objects        ENABLE ROW LEVEL SECURITY;
CREATE POLICY "confirmation_letter_objects_via_audit"
  ON confirmation_letter_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));

ALTER TABLE agenda_objects                     ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agenda_objects_via_audit"
  ON agenda_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));

ALTER TABLE checklist_objects                  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checklist_objects_via_audit"
  ON checklist_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));


-- =============================================================================
-- EVIDENCE ATTACHMENTS + JUNCTIONS
-- Evidence attachments are visible if linked to any object the user can see.
-- For Phase 1 we keep it simple: uploader can see their own evidence; access
-- via junction follows the underlying object's visibility.
-- =============================================================================

ALTER TABLE evidence_attachments ENABLE ROW LEVEL SECURITY;

-- Uploader can always see + manage their own evidence.
CREATE POLICY "evidence_attachments_uploader"
  ON evidence_attachments FOR ALL
  TO authenticated
  USING       (uploaded_by = auth.uid())
  WITH CHECK  (uploaded_by = auth.uid());

-- Visible to anyone who can see a linked workspace entry.
CREATE POLICY "evidence_attachments_via_workspace_entry"
  ON evidence_attachments FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT e.evidence_id
        FROM evidence_on_workspace_entries e
        JOIN audit_workspace_entry_objects we ON we.id = e.workspace_entry_id
        JOIN audits a ON a.id = we.audit_id
       WHERE a.lead_auditor_id = auth.uid()
    )
  );

-- Visible to anyone who can see a linked questionnaire response.
CREATE POLICY "evidence_attachments_via_questionnaire_response"
  ON evidence_attachments FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT e.evidence_id
        FROM evidence_on_questionnaire_responses e
        JOIN questionnaire_response_objects qr ON qr.id = e.questionnaire_response_id
        JOIN audits a ON a.id = qr.audit_id
       WHERE a.lead_auditor_id = auth.uid()
    )
  );

ALTER TABLE evidence_on_workspace_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evidence_on_workspace_entries_via_audit"
  ON evidence_on_workspace_entries FOR ALL
  TO authenticated
  USING (
    workspace_entry_id IN (
      SELECT we.id FROM audit_workspace_entry_objects we
      JOIN audits a ON a.id = we.audit_id
      WHERE a.lead_auditor_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_entry_id IN (
      SELECT we.id FROM audit_workspace_entry_objects we
      JOIN audits a ON a.id = we.audit_id
      WHERE a.lead_auditor_id = auth.uid()
    )
  );

ALTER TABLE evidence_on_questionnaire_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evidence_on_questionnaire_responses_via_audit"
  ON evidence_on_questionnaire_responses FOR ALL
  TO authenticated
  USING (
    questionnaire_response_id IN (
      SELECT qr.id FROM questionnaire_response_objects qr
      JOIN audits a ON a.id = qr.audit_id
      WHERE a.lead_auditor_id = auth.uid()
    )
  )
  WITH CHECK (
    questionnaire_response_id IN (
      SELECT qr.id FROM questionnaire_response_objects qr
      JOIN audits a ON a.id = qr.audit_id
      WHERE a.lead_auditor_id = auth.uid()
    )
  );


-- =============================================================================
-- STATE HISTORY DELTAS
-- Polymorphic visibility: visible iff the user can see the underlying object.
-- INSERT is restricted to actors writing under their own identity. UPDATE and
-- DELETE are forbidden — append-only audit trail.
-- =============================================================================

ALTER TABLE state_history_deltas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "state_history_deltas_select_via_object"
  ON state_history_deltas FOR SELECT
  TO authenticated
  USING (audit_mode_can_view_tracked_object(object_type, object_id));

CREATE POLICY "state_history_deltas_insert_self_actor"
  ON state_history_deltas FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND audit_mode_can_view_tracked_object(object_type, object_id)
  );

-- No UPDATE policy — table is append-only.
-- No DELETE policy — table is append-only.
