-- =============================================================================
-- Audit Mode — ISA site module mapping RPCs (isa-site-modules)
--
-- Companion to 20260917000000. Three things, in the order the delta policy
-- needs them:
--
--   1. audit_mode_can_view_tracked_object — full replacement adding the
--      SITE_MODULE_MAPPING_OBJECT branch (every earlier branch kept verbatim
--      from 20260907000100). The state_history_deltas INSERT policy calls it,
--      so it must know the new type before the first create writes a delta.
--      Signature and contract unchanged.
--
--   2. audit_mode_create_site_module_mapping — mirrors
--      audit_mode_create_service_mapping (20260430140000): SECURITY INVOKER
--      (RLS on audits / protocol_risk_objects / the mapping table does the
--      authorisation), criticality and rationale from the same immutable
--      functions, one delta per create. Two integrity guards the vendor RPC
--      never needed: the audit must be an investigator site audit
--      (22023 / WORKFLOW_NOT_ISA), and the risk must belong to the audit's
--      protocol version (22023 / RISK_NOT_ON_AUDIT_PROTOCOL) — a mapping to
--      another study's risk would be nonsense that RLS alone cannot see.
--      No rationale override parameter: nothing consumes one; the derived
--      rationale is the record. A duplicate (audit, risk, module) surfaces
--      as the UNIQUE violation (23505); the client hides mapped modules from
--      the picker, so only a race reaches it.
--
--   3. audit_mode_delete_site_module_mapping — mirrors
--      audit_mode_delete_service_mapping: delta first (with the row's values
--      going to NULL), then the row.
--
-- Not built: an update RPC for an auditor criticality override (the vendor
-- lane has one). No caller yet — ledgered in
-- plans/sixonelabs-piqc/isa-site-modules.md.
--
-- Grants per 20260911000000: REVOKE the default PUBLIC/anon EXECUTE, GRANT
-- to authenticated + service_role, signatures pinned.
--
-- TS mirror: src/types/audit/objects.ts (SiteModuleMapping) and
-- src/types/audit/enums.ts (TrackedObjectType) change in the same PR.
--
-- Owner: @rv61.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. audit_mode_can_view_tracked_object — adds SITE_MODULE_MAPPING_OBJECT
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
-- 2. audit_mode_create_site_module_mapping
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_site_module_mapping(
  p_audit_id         uuid,
  p_protocol_risk_id uuid,
  p_isa_domain       isa_domain
)
RETURNS site_module_mapping_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_audit       audits;
  v_risk        protocol_risk_objects;
  v_criticality derived_criticality;
  v_rationale   text;
  v_row         site_module_mapping_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- INVOKER: RLS on audits hides other leads' audits — same not-found either way.
  SELECT * INTO v_audit FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  IF v_audit.workflow_type <> 'INVESTIGATOR_SITE_AUDIT' THEN
    RAISE EXCEPTION 'Audit % is not an investigator site audit', p_audit_id
      USING ERRCODE = '22023', HINT = 'WORKFLOW_NOT_ISA';
  END IF;

  SELECT * INTO v_risk FROM protocol_risk_objects WHERE id = p_protocol_risk_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Protocol risk % not found', p_protocol_risk_id USING ERRCODE = 'P0002';
  END IF;

  IF v_risk.protocol_version_id IS DISTINCT FROM v_audit.protocol_version_id THEN
    RAISE EXCEPTION 'Protocol risk % is not on this audit''s protocol version', p_protocol_risk_id
      USING ERRCODE = '22023', HINT = 'RISK_NOT_ON_AUDIT_PROTOCOL';
  END IF;

  v_criticality := audit_mode_derive_criticality(
    v_risk.endpoint_tier, v_risk.impact_surface, v_risk.time_sensitivity
  );
  v_rationale := audit_mode_build_default_rationale(
    v_risk.endpoint_tier, v_risk.impact_surface, v_risk.time_sensitivity
  );

  INSERT INTO site_module_mapping_objects (
    audit_id, protocol_risk_id, isa_domain, derived_criticality, criticality_rationale
  ) VALUES (
    p_audit_id, p_protocol_risk_id, p_isa_domain, v_criticality, v_rationale
  )
  RETURNING * INTO v_row;

  PERFORM audit_mode_write_delta(
    'SITE_MODULE_MAPPING_OBJECT'::tracked_object_type,
    v_row.id,
    jsonb_build_object(
      'protocol_risk_id',      jsonb_build_object('from', NULL, 'to', v_row.protocol_risk_id),
      'isa_domain',            jsonb_build_object('from', NULL, 'to', v_row.isa_domain),
      'derived_criticality',   jsonb_build_object('from', NULL, 'to', v_row.derived_criticality),
      'criticality_rationale', jsonb_build_object('from', NULL, 'to', v_row.criticality_rationale)
    ),
    v_user,
    'Site module mapping created'
  );

  RETURN v_row;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. audit_mode_delete_site_module_mapping
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_delete_site_module_mapping(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before site_module_mapping_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM site_module_mapping_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  PERFORM audit_mode_write_delta(
    'SITE_MODULE_MAPPING_OBJECT'::tracked_object_type,
    v_before.id,
    jsonb_build_object(
      'protocol_risk_id',      jsonb_build_object('from', v_before.protocol_risk_id,      'to', NULL),
      'isa_domain',            jsonb_build_object('from', v_before.isa_domain,            'to', NULL),
      'derived_criticality',   jsonb_build_object('from', v_before.derived_criticality,   'to', NULL),
      'criticality_rationale', jsonb_build_object('from', v_before.criticality_rationale, 'to', NULL)
    ),
    v_user,
    COALESCE(p_reason, 'Site module mapping deleted')
  );

  DELETE FROM site_module_mapping_objects WHERE id = p_id;
  RETURN TRUE;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants (20260911000000 pattern)
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.audit_mode_create_site_module_mapping(uuid, uuid, isa_domain)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_mode_create_site_module_mapping(uuid, uuid, isa_domain)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.audit_mode_delete_site_module_mapping(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_mode_delete_site_module_mapping(uuid, text)
  TO authenticated, service_role;
