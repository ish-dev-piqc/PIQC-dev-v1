-- =============================================================================
-- Audit Mode — ISA document request: RPC slice (isa-document-request)
--
-- Companion to 20260920000000 (enum value + table). Split so the new
-- tracked_object_type value is never referenced in the transaction that
-- added it (20260707000200 precedent).
--
-- NO NEW FUNCTIONS. The request is served by the generic deliverable pair
-- (audit_mode_upsert_deliverable / audit_mode_approve_deliverable,
-- 20260906000100 + 20260907000100), which dispatch on a kind whitelist.
-- Two full replacements, contracts unchanged, every earlier arm verbatim:
--
--   1. audit_mode_can_view_tracked_object — adds the DOCUMENT_REQUEST_OBJECT
--      branch (every branch from 20260918000100 kept). The
--      state_history_deltas INSERT policy runs it, so the branch must exist
--      before the first upsert writes a delta.
--
--   2. audit_mode_deliverable_kind_config — 9th arm, 'document_request' →
--      document_request_objects / DOCUMENT_REQUEST_OBJECT / 'Document
--      request' / o_basis NULL (every arm from 20260918000100 kept). NULL
--      basis: the approve arm CAS-pins the row's own updated_at and refuses
--      a digest for this kind (22023) — the standard latch of the letter /
--      agenda / checklist / site_scope kinds. The request's derivation basis
--      (the scope's module set) is recorded in content.built_from and
--      checked client-side; a server pin ('SCOPE_VERSION', a third basis
--      token) is ledgered in plans/sixonelabs-piqc/isa-document-request.md.
--
-- Signatures unchanged, so CREATE OR REPLACE preserves the ACLs both
-- functions already carry (kind_config: PUBLIC/anon revoked in 20260907000100;
-- can_view: the default EXECUTE it has always had — it is run by RLS policies,
-- not called by clients). No grants block needed.
--
-- TS mirror: src/types/audit/enums.ts (TrackedObjectType) and
-- src/types/audit/objects.ts (DocumentRequestContent) change in the same PR.
--
-- Owner: @rv61.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. audit_mode_can_view_tracked_object — adds DOCUMENT_REQUEST_OBJECT
-- -----------------------------------------------------------------------------
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

  IF obj_type = 'PROTOCOL_RISK_OBJECT' THEN
    RETURN TRUE;
  END IF;

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
  ELSIF obj_type = 'SITE_MODULE_MAPPING_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM site_module_mapping_objects smm
      JOIN audits a ON a.id = smm.audit_id
     WHERE smm.id = obj_id;
  ELSIF obj_type = 'SITE_SCOPE_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM site_scope_objects ss
      JOIN audits a ON a.id = ss.audit_id
     WHERE ss.id = obj_id;
  ELSIF obj_type = 'DOCUMENT_REQUEST_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM document_request_objects dr
      JOIN audits a ON a.id = dr.audit_id
     WHERE dr.id = obj_id;
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
  ELSIF obj_type = 'AUDIT_NOTE_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM audit_note_objects n
      JOIN audits a ON a.id = n.audit_id
     WHERE n.id = obj_id;
  ELSIF obj_type = 'ISA_FINDING_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM isa_finding_objects f
      JOIN audits a ON a.id = f.audit_id
     WHERE f.id = obj_id;
  ELSIF obj_type = 'ISA_REPORT_DRAFT_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM isa_report_draft_objects rp
      JOIN audits a ON a.id = rp.audit_id
     WHERE rp.id = obj_id;
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
  ELSIF obj_type = 'INTERNAL_NOTIFICATION_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM internal_notification_objects intn
      JOIN audits a ON a.id = intn.audit_id
     WHERE intn.id = obj_id;
  ELSIF obj_type = 'EVIDENCE_GAP_SUMMARY_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM evidence_gap_summary_objects egs
      JOIN audits a ON a.id = egs.audit_id
     WHERE egs.id = obj_id;
  ELSIF obj_type = 'FINDINGS_REPORT_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM findings_report_objects fr
      JOIN audits a ON a.id = fr.audit_id
     WHERE fr.id = obj_id;
  ELSIF obj_type = 'AUDIT_CERTIFICATE_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM audit_certificate_objects ac
      JOIN audits a ON a.id = ac.audit_id
     WHERE ac.id = obj_id;
  ELSIF obj_type = 'REPORT_DRAFT_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM report_draft_objects rd
      JOIN audits a ON a.id = rd.audit_id
     WHERE rd.id = obj_id;
  ELSIF obj_type = 'ISSUE_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM issue_objects iss
      JOIN audits a ON a.id = iss.audit_id
     WHERE iss.id = obj_id;
  ELSIF obj_type = 'CAPA_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM capa_objects cp
      JOIN audits a ON a.id = cp.audit_id
     WHERE cp.id = obj_id;
  ELSE
    RETURN FALSE;
  END IF;

  RETURN v_lead IS NOT NULL AND v_lead = auth.uid();
END;
$$;


-- -----------------------------------------------------------------------------
-- 2. audit_mode_deliverable_kind_config — 9th arm. Dynamic SQL in the generic
-- pair only ever interpolates o_table via %I, and o_table only ever comes
-- from this CASE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_deliverable_kind_config(
  p_kind    text,
  OUT o_table   text,
  OUT o_tracked tracked_object_type,
  OUT o_noun    text,
  OUT o_basis   text  -- NULL, 'ENTRY_SET' (pins the entry-set digest), or
                      -- 'REPORT_VERSION' (pins the approved report fingerprint)
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_kind
    WHEN 'confirmation_letter' THEN
      o_table := 'confirmation_letter_objects';
      o_tracked := 'CONFIRMATION_LETTER_OBJECT';
      o_noun := 'Confirmation letter';
      o_basis := NULL;
    WHEN 'agenda' THEN
      o_table := 'agenda_objects';
      o_tracked := 'AGENDA_OBJECT';
      o_noun := 'Agenda';
      o_basis := NULL;
    WHEN 'checklist' THEN
      o_table := 'checklist_objects';
      o_tracked := 'CHECKLIST_OBJECT';
      o_noun := 'Checklist';
      o_basis := NULL;
    WHEN 'internal_notification' THEN
      o_table := 'internal_notification_objects';
      o_tracked := 'INTERNAL_NOTIFICATION_OBJECT';
      o_noun := 'Internal notification';
      o_basis := NULL;
    WHEN 'evidence_gap_summary' THEN
      o_table := 'evidence_gap_summary_objects';
      o_tracked := 'EVIDENCE_GAP_SUMMARY_OBJECT';
      o_noun := 'Evidence gap summary';
      o_basis := NULL;
    WHEN 'findings_report' THEN
      o_table := 'findings_report_objects';
      o_tracked := 'FINDINGS_REPORT_OBJECT';
      o_noun := 'Findings report';
      o_basis := 'ENTRY_SET';
    WHEN 'audit_certificate' THEN
      o_table := 'audit_certificate_objects';
      o_tracked := 'AUDIT_CERTIFICATE_OBJECT';
      o_noun := 'Audit certificate';
      o_basis := 'REPORT_VERSION';
    WHEN 'site_scope' THEN
      o_table := 'site_scope_objects';
      o_tracked := 'SITE_SCOPE_OBJECT';
      o_noun := 'Site audit scope';
      o_basis := NULL;
    WHEN 'document_request' THEN
      o_table := 'document_request_objects';
      o_tracked := 'DOCUMENT_REQUEST_OBJECT';
      o_noun := 'Document request';
      o_basis := NULL;
    ELSE
      RAISE EXCEPTION 'Unknown deliverable kind %', p_kind USING ERRCODE = '22023';
  END CASE;
END;
$$;
