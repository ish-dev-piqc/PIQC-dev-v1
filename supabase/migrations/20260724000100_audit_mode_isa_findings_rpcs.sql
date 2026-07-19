-- =============================================================================
-- Audit Mode — ISA finding mutation RPCs
--
-- Create / update for isa_finding_objects. No delete — findings are
-- append-only (GxP trail), corrected via update with delta tracking.
--
-- The DB is the LAST gate for the evidence chain (defense in depth behind the
-- edge function's cite-or-drop): every source_note_id inside p_evidence must
-- resolve to a live note on the same audit, not already promoted to another
-- finding. Accepting a finding atomically stamps promoted_finding_id on the
-- cited notes; updating a finding's evidence re-syncs the stamps.
--
-- Origin honesty: a PIQC_DRAFTED finding flips to PIQC_EDITED on the first
-- content edit (title / domain / subcategory / severity / observation /
-- evidence / reference). Provenance never lies about how much of the text is
-- the model's.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_mode_validate_isa_evidence — shared evidence validation.
--
-- Checks shape ([{ text, source_note_ids: [] }]) and note resolvability.
-- p_finding_id: NULL on create; on update, notes already promoted to THIS
-- finding remain valid citations.
-- Returns the distinct cited note ids.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_validate_isa_evidence(
  p_audit_id   uuid,
  p_evidence   jsonb,
  p_finding_id uuid DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item     jsonb;
  v_note_ids uuid[];
  v_valid    int;
BEGIN
  IF jsonb_typeof(p_evidence) <> 'array' THEN
    RAISE EXCEPTION 'evidence must be a JSON array' USING ERRCODE = '23514';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_evidence) LOOP
    IF jsonb_typeof(v_item->'text') <> 'string'
       OR length(btrim(v_item->>'text')) = 0 THEN
      RAISE EXCEPTION 'each evidence item needs non-empty text' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(v_item->'source_note_ids') <> 'array' THEN
      RAISE EXCEPTION 'each evidence item needs a source_note_ids array' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(DISTINCT nid::uuid), '{}'::uuid[])
    INTO v_note_ids
    FROM jsonb_array_elements(p_evidence) AS item,
         jsonb_array_elements_text(item->'source_note_ids') AS nid;

  IF array_length(v_note_ids, 1) IS NOT NULL THEN
    SELECT count(*) INTO v_valid
      FROM audit_note_objects n
     WHERE n.id = ANY(v_note_ids)
       AND n.audit_id = p_audit_id
       AND n.deleted_at IS NULL
       AND (n.promoted_finding_id IS NULL
            OR (p_finding_id IS NOT NULL AND n.promoted_finding_id = p_finding_id));

    IF v_valid <> array_length(v_note_ids, 1) THEN
      RAISE EXCEPTION 'evidence cites a note that is missing, deleted, or already promoted'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN v_note_ids;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_create_isa_finding
--
-- PIQC-originated findings (PIQC_DRAFTED / PIQC_EDITED) must arrive with a
-- non-empty evidence trail — cite-or-drop holds at the DB layer, not just in
-- the edge function. AUDITOR findings may start without evidence (the auditor
-- is the source).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_isa_finding(
  p_audit_id       uuid,
  p_title          text,
  p_isa_domain     isa_domain,
  p_severity       isa_severity,
  p_observation    text,
  p_evidence       jsonb,
  p_origin         isa_finding_origin,
  p_subcategory    text               DEFAULT NULL,
  p_severity_rule  text               DEFAULT NULL,
  p_reference      text               DEFAULT NULL,
  p_response_owner isa_response_owner DEFAULT 'SITE',
  p_reason         text               DEFAULT NULL
)
RETURNS isa_finding_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_workflow audit_workflow_type;
  v_note_ids uuid[];
  v_after    isa_finding_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title must not be empty' USING ERRCODE = '23514';
  END IF;
  IF length(btrim(p_observation)) = 0 THEN
    RAISE EXCEPTION 'observation must not be empty' USING ERRCODE = '23514';
  END IF;

  SELECT workflow_type INTO v_workflow FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;
  IF v_workflow <> 'INVESTIGATOR_SITE_AUDIT' THEN
    RAISE EXCEPTION 'ISA findings are only available on investigator site audits'
      USING ERRCODE = '23514';
  END IF;

  v_note_ids := audit_mode_validate_isa_evidence(p_audit_id, p_evidence, NULL);

  IF p_origin <> 'AUDITOR'
     AND (array_length(v_note_ids, 1) IS NULL OR jsonb_array_length(p_evidence) = 0) THEN
    RAISE EXCEPTION 'PIQC-drafted findings must cite at least one source note'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO isa_finding_objects (
    audit_id, title, isa_domain, subcategory, severity, severity_rule,
    observation, evidence, reference, response_owner, origin, created_by
  ) VALUES (
    p_audit_id, btrim(p_title), p_isa_domain, NULLIF(btrim(COALESCE(p_subcategory, '')), ''),
    p_severity, NULLIF(btrim(COALESCE(p_severity_rule, '')), ''),
    btrim(p_observation), p_evidence, NULLIF(btrim(COALESCE(p_reference, '')), ''),
    p_response_owner, p_origin, v_user
  )
  RETURNING * INTO v_after;

  -- Promote the cited notes — atomic with the finding insert.
  IF array_length(v_note_ids, 1) IS NOT NULL THEN
    UPDATE audit_note_objects
       SET promoted_finding_id = v_after.id
     WHERE id = ANY(v_note_ids);
  END IF;

  PERFORM audit_mode_write_delta(
    'ISA_FINDING_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'title',       jsonb_build_object('from', NULL, 'to', v_after.title),
      'isa_domain',  jsonb_build_object('from', NULL, 'to', v_after.isa_domain),
      'severity',    jsonb_build_object('from', NULL, 'to', v_after.severity),
      'observation', jsonb_build_object('from', NULL, 'to', v_after.observation),
      'evidence',    jsonb_build_object('from', NULL, 'to', v_after.evidence),
      'reference',   jsonb_build_object('from', NULL, 'to', v_after.reference),
      'origin',      jsonb_build_object('from', NULL, 'to', v_after.origin)
    ),
    v_user,
    COALESCE(p_reason, 'Finding created')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_update_isa_finding
--
-- NULL params leave fields alone; p_clear_* flags clear nullable fields.
-- Evidence replacement re-syncs note promotion stamps (un-cited notes are
-- released back to the pad; newly cited notes are stamped).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_update_isa_finding(
  p_id                  uuid,
  p_title               text               DEFAULT NULL,
  p_isa_domain          isa_domain         DEFAULT NULL,
  p_subcategory         text               DEFAULT NULL,
  p_clear_subcategory   boolean            DEFAULT FALSE,
  p_severity            isa_severity       DEFAULT NULL,
  p_severity_rule       text               DEFAULT NULL,
  p_clear_severity_rule boolean            DEFAULT FALSE,
  p_observation         text               DEFAULT NULL,
  p_evidence            jsonb              DEFAULT NULL,
  p_reference           text               DEFAULT NULL,
  p_clear_reference     boolean            DEFAULT FALSE,
  p_response_owner      isa_response_owner DEFAULT NULL,
  p_reason              text               DEFAULT NULL
)
RETURNS isa_finding_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user            uuid := auth.uid();
  v_before          isa_finding_objects;
  v_after           isa_finding_objects;
  v_note_ids        uuid[];
  v_delta           jsonb := '{}'::jsonb;
  v_content_changed boolean := FALSE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM isa_finding_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finding % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  IF p_title IS NOT NULL AND length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title must not be empty' USING ERRCODE = '23514';
  END IF;
  IF p_observation IS NOT NULL AND length(btrim(p_observation)) = 0 THEN
    RAISE EXCEPTION 'observation must not be empty' USING ERRCODE = '23514';
  END IF;

  IF p_evidence IS NOT NULL THEN
    v_note_ids := audit_mode_validate_isa_evidence(v_before.audit_id, p_evidence, p_id);
  END IF;

  UPDATE isa_finding_objects
     SET title          = COALESCE(btrim(p_title), title),
         isa_domain     = COALESCE(p_isa_domain, isa_domain),
         subcategory    = CASE WHEN p_clear_subcategory THEN NULL
                               ELSE COALESCE(NULLIF(btrim(COALESCE(p_subcategory, '')), ''), subcategory) END,
         severity       = COALESCE(p_severity, severity),
         severity_rule  = CASE WHEN p_clear_severity_rule THEN NULL
                               ELSE COALESCE(NULLIF(btrim(COALESCE(p_severity_rule, '')), ''), severity_rule) END,
         observation    = COALESCE(btrim(p_observation), observation),
         evidence       = COALESCE(p_evidence, evidence),
         reference      = CASE WHEN p_clear_reference THEN NULL
                               ELSE COALESCE(NULLIF(btrim(COALESCE(p_reference, '')), ''), reference) END,
         response_owner = COALESCE(p_response_owner, response_owner)
   WHERE id = p_id
  RETURNING * INTO v_after;

  -- Promotion re-sync on evidence change.
  IF p_evidence IS NOT NULL THEN
    UPDATE audit_note_objects
       SET promoted_finding_id = NULL
     WHERE promoted_finding_id = p_id
       AND NOT (id = ANY(COALESCE(v_note_ids, '{}'::uuid[])));
    IF array_length(v_note_ids, 1) IS NOT NULL THEN
      UPDATE audit_note_objects
         SET promoted_finding_id = p_id
       WHERE id = ANY(v_note_ids);
    END IF;
  END IF;

  IF v_before.title IS DISTINCT FROM v_after.title THEN
    v_delta := v_delta || jsonb_build_object('title',
      jsonb_build_object('from', v_before.title, 'to', v_after.title));
    v_content_changed := TRUE;
  END IF;
  IF v_before.isa_domain IS DISTINCT FROM v_after.isa_domain THEN
    v_delta := v_delta || jsonb_build_object('isa_domain',
      jsonb_build_object('from', v_before.isa_domain, 'to', v_after.isa_domain));
    v_content_changed := TRUE;
  END IF;
  IF v_before.subcategory IS DISTINCT FROM v_after.subcategory THEN
    v_delta := v_delta || jsonb_build_object('subcategory',
      jsonb_build_object('from', v_before.subcategory, 'to', v_after.subcategory));
    v_content_changed := TRUE;
  END IF;
  IF v_before.severity IS DISTINCT FROM v_after.severity THEN
    v_delta := v_delta || jsonb_build_object('severity',
      jsonb_build_object('from', v_before.severity, 'to', v_after.severity));
    v_content_changed := TRUE;
  END IF;
  IF v_before.severity_rule IS DISTINCT FROM v_after.severity_rule THEN
    v_delta := v_delta || jsonb_build_object('severity_rule',
      jsonb_build_object('from', v_before.severity_rule, 'to', v_after.severity_rule));
  END IF;
  IF v_before.observation IS DISTINCT FROM v_after.observation THEN
    v_delta := v_delta || jsonb_build_object('observation',
      jsonb_build_object('from', v_before.observation, 'to', v_after.observation));
    v_content_changed := TRUE;
  END IF;
  IF v_before.evidence IS DISTINCT FROM v_after.evidence THEN
    v_delta := v_delta || jsonb_build_object('evidence',
      jsonb_build_object('from', v_before.evidence, 'to', v_after.evidence));
    v_content_changed := TRUE;
  END IF;
  IF v_before.reference IS DISTINCT FROM v_after.reference THEN
    v_delta := v_delta || jsonb_build_object('reference',
      jsonb_build_object('from', v_before.reference, 'to', v_after.reference));
    v_content_changed := TRUE;
  END IF;
  IF v_before.response_owner IS DISTINCT FROM v_after.response_owner THEN
    v_delta := v_delta || jsonb_build_object('response_owner',
      jsonb_build_object('from', v_before.response_owner, 'to', v_after.response_owner));
  END IF;

  -- Provenance honesty: first content edit de-attributes the pure draft.
  IF v_content_changed AND v_before.origin = 'PIQC_DRAFTED' THEN
    UPDATE isa_finding_objects SET origin = 'PIQC_EDITED' WHERE id = p_id
    RETURNING * INTO v_after;
    v_delta := v_delta || jsonb_build_object('origin',
      jsonb_build_object('from', v_before.origin, 'to', v_after.origin));
  END IF;

  IF v_delta <> '{}'::jsonb THEN
    PERFORM audit_mode_write_delta(
      'ISA_FINDING_OBJECT'::tracked_object_type,
      v_after.id,
      v_delta,
      v_user,
      COALESCE(p_reason, 'Finding updated')
    );
  END IF;

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_can_view_tracked_object — full replacement adding the
-- ISA_FINDING_OBJECT branch (keeps AUDIT_NOTE_OBJECT from 20260723000100 and
-- ISSUE/CAPA from 20260707000300).
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
-- audit_mode_delete_isa_note — replacement of the S1 soft-delete adding the
-- promoted-note guard: a note cited by a finding's evidence is part of that
-- finding's provable chain and cannot be deleted (release it first by editing
-- the finding's evidence). S1 shipped without the guard because
-- promoted_finding_id did not exist yet.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_delete_isa_note(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS audit_note_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_after audit_note_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM audit_note_objects
     WHERE id = p_id AND promoted_finding_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Note is cited by a finding and cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  UPDATE audit_note_objects
     SET deleted_at = NOW()
   WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_after;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  PERFORM audit_mode_write_delta(
    'AUDIT_NOTE_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'deleted_at', jsonb_build_object('from', NULL, 'to', v_after.deleted_at)
    ),
    v_user,
    COALESCE(p_reason, 'Note deleted')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_validate_isa_evidence(uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_create_isa_finding(
  uuid, text, isa_domain, isa_severity, text, jsonb, isa_finding_origin,
  text, text, text, isa_response_owner, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_update_isa_finding(
  uuid, text, isa_domain, text, boolean, isa_severity, text, boolean,
  text, jsonb, text, boolean, isa_response_owner, text
) TO authenticated;
