-- =============================================================================
-- Audit Mode — audit certificate: RPC slice (PR-D6)
--
-- Companion to 20260907000000 (enum value + table). Split so the new
-- tracked_object_type value is never referenced in the transaction that added
-- it (20260707000200 precedent).
--
-- This is where the deliverable-to-deliverable prerequisite machinery from
-- PR-D4 completes: the generic approve gains its SECOND basis token,
-- 'REPORT_VERSION'. The certificate's latch has two pins:
--   - updated_at CAS           → the certificate text the reviewer saw
--   - report fingerprint CAS   → WHICH approved Stage-7 report they saw. The
--     live digest is report_draft_objects.readiness_fingerprint, but only
--     while approval_status = 'APPROVED' — the fingerprint is server-sealed
--     by audit_mode_approve_report_draft (20260730000000) and nulled by the
--     report upsert's demote-on-edit, so it is precisely "the version a
--     human approved". Unapproved / absent / legacy-unfingerprinted report
--     → live digest NULL → any pin mismatches → the certificate cannot be
--     approved until the report is (re-)approved.
-- The verified digest seals into basis_digest; demote-on-edit clears it
-- (the generic upsert's basis clear is kind-agnostic — not replaced here).
-- A report demoted between the digest check and the seal UPDATE falls to the
-- client divergence re-check (live fingerprint vs basis_digest), the same
-- documented window as ENTRY_SET (20260906000100) and GATE_REPORT_DIVERGED.
--
-- audit_mode_deliverable_kind_config and audit_mode_approve_deliverable are
-- CREATE OR REPLACEd in full (every existing arm kept verbatim; behavior for
-- the six existing kinds unchanged). Both were created in 20260906000100,
-- which is UNAPPLIED in prod — prod receives only this 7-kind version.
-- CREATE OR REPLACE preserves grants, so only the new apply RPC needs the
-- REVOKE/GRANT block. Plus audit_mode_can_view_tracked_object replaced in
-- full, adding the AUDIT_CERTIFICATE_OBJECT branch.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_mode_can_view_tracked_object — full replacement adding the
-- AUDIT_CERTIFICATE_OBJECT branch (every branch from 20260906000100 kept).
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
-- Kind whitelist — 7th arm. Dynamic SQL in the generic pair only ever
-- interpolates o_table via %I, and o_table only ever comes from this CASE.
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
    ELSE
      RAISE EXCEPTION 'Unknown deliverable kind %', p_kind USING ERRCODE = '22023';
  END CASE;
END;
$$;


-- -----------------------------------------------------------------------------
-- Generic approve — full replacement adding the REPORT_VERSION basis token.
-- The ENTRY_SET arms, the misuse guard, the CAS shapes, and the delta diff
-- are verbatim from 20260906000100; only the new token's paired verification
-- + seal arms are added (the extension its comment prescribed).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_approve_deliverable(
  p_kind                  text,
  p_id                    uuid,
  p_reason                text        DEFAULT NULL,
  p_expected_updated_at   timestamptz DEFAULT NULL,
  p_expected_basis_digest text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_cfg         record;
  v_before      jsonb;
  v_after       jsonb;
  v_diff        jsonb;
  v_live_digest text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Approve requires the version being reviewed (expected_updated_at)'
      USING ERRCODE = '22023', HINT = 'MISSING_EXPECTED_VERSION';
  END IF;

  SELECT * INTO v_cfg FROM audit_mode_deliverable_kind_config(p_kind);

  EXECUTE format('SELECT to_jsonb(t.*) FROM %I t WHERE t.id = $1', v_cfg.o_table)
    INTO v_before USING p_id;
  IF v_before IS NULL THEN
    RAISE EXCEPTION '% % not found', v_cfg.o_noun, p_id USING ERRCODE = 'P0002';
  END IF;

  IF v_cfg.o_basis = 'ENTRY_SET' THEN
    IF p_expected_basis_digest IS NULL THEN
      RAISE EXCEPTION 'Approve requires the observation set being reviewed (expected_basis_digest)'
        USING ERRCODE = '22023', HINT = 'MISSING_EXPECTED_BASIS';
    END IF;
    v_live_digest := audit_mode_entry_set_digest((v_before->>'audit_id')::uuid);
    IF v_live_digest IS DISTINCT FROM p_expected_basis_digest THEN
      RAISE EXCEPTION 'The observations this deliverable is built from changed since they were reviewed'
        USING ERRCODE = '40001', HINT = 'STALE_BASIS';
    END IF;
  ELSIF v_cfg.o_basis = 'REPORT_VERSION' THEN
    IF p_expected_basis_digest IS NULL THEN
      RAISE EXCEPTION 'Approve requires the approved report version being reviewed (expected_basis_digest)'
        USING ERRCODE = '22023', HINT = 'MISSING_EXPECTED_BASIS';
    END IF;
    -- The live digest is the fingerprint the report's OWN approve sealed,
    -- and only while that approval stands: an unapproved, absent, or
    -- legacy-unfingerprinted report yields NULL, which mismatches every
    -- pin — the certificate cannot be approved until the report is.
    SELECT CASE WHEN r.approval_status = 'APPROVED' THEN r.readiness_fingerprint END
      INTO v_live_digest
      FROM report_draft_objects r
     WHERE r.audit_id = (v_before->>'audit_id')::uuid;
    IF v_live_digest IS NULL OR v_live_digest IS DISTINCT FROM p_expected_basis_digest THEN
      RAISE EXCEPTION 'The approved report this certificate certifies changed or is no longer approved'
        USING ERRCODE = '40001', HINT = 'STALE_BASIS';
    END IF;
  ELSIF p_expected_basis_digest IS NOT NULL THEN
    -- A basis pin passed for a kind that declares none is a caller bug, and
    -- silently ignoring it would read as protection that quietly isn't there
    -- (the trap for the day the five legacy kinds migrate onto this pair).
    RAISE EXCEPTION 'Deliverable kind % declares no approval basis — expected_basis_digest must not be passed', p_kind
      USING ERRCODE = '22023';
  END IF;

  -- Atomic CAS in the UPDATE predicate (see approve_confirmation_letter).
  -- Basis kinds seal the verified digest in the same statement; a concurrent
  -- basis change between the check above and this UPDATE is caught by the
  -- divergence re-check (live digest vs basis_digest), not here. Gated on
  -- the SAME tokens as the verification blocks above — a future basis token
  -- must extend the verification, this arm, and the upsert's clear together,
  -- or it could seal a digest it never verified.
  IF v_cfg.o_basis = 'ENTRY_SET' OR v_cfg.o_basis = 'REPORT_VERSION' THEN
    EXECUTE format(
      'UPDATE %I SET
         approval_status = ''APPROVED'',
         approved_at     = NOW(),
         approved_by     = $2,
         basis_digest    = $3
       WHERE id = $1
         AND updated_at = $4
       RETURNING to_jsonb(%I.*)',
      v_cfg.o_table, v_cfg.o_table)
      INTO v_after USING p_id, v_user, v_live_digest, p_expected_updated_at;
  ELSE
    EXECUTE format(
      'UPDATE %I SET
         approval_status = ''APPROVED'',
         approved_at     = NOW(),
         approved_by     = $2
       WHERE id = $1
         AND updated_at = $3
       RETURNING to_jsonb(%I.*)',
      v_cfg.o_table, v_cfg.o_table)
      INTO v_after USING p_id, v_user, p_expected_updated_at;
  END IF;

  IF v_after IS NULL THEN
    RAISE EXCEPTION '% changed since it was last reviewed', v_cfg.o_noun
      USING ERRCODE = '40001', HINT = 'STALE_CONTENT';
  END IF;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'approval_status', v_before->'approval_status',
      'approved_at',     v_before->'approved_at',
      'approved_by',     v_before->'approved_by'
    ) || CASE WHEN v_cfg.o_basis IS NOT NULL
         THEN jsonb_build_object('basis_digest', v_before->'basis_digest')
         ELSE '{}'::jsonb END,
    jsonb_build_object(
      'approval_status', v_after->'approval_status',
      'approved_at',     v_after->'approved_at',
      'approved_by',     v_after->'approved_by'
    ) || CASE WHEN v_cfg.o_basis IS NOT NULL
         THEN jsonb_build_object('basis_digest', v_after->'basis_digest')
         ELSE '{}'::jsonb END
  );

  PERFORM audit_mode_write_delta(
    v_cfg.o_tracked,
    (v_after->>'id')::uuid,
    v_diff,
    v_user,
    COALESCE(p_reason, v_cfg.o_noun || ' approved')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Apply generation — content through the generic upsert (demote latch reused,
-- never duplicated), then the provenance stamp in the same transaction.
-- Per-kind signature so the client's APPLY_RPC record stays uniform.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_apply_audit_certificate_generation(
  p_audit_id           uuid,
  p_content            jsonb,
  p_generation_refs    jsonb,
  p_grounding_snapshot jsonb,
  p_reason             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_after jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_generation_refs IS NULL OR jsonb_typeof(p_generation_refs) <> 'array' THEN
    RAISE EXCEPTION 'generation_refs must be a JSON array' USING ERRCODE = '23514';
  END IF;
  IF p_grounding_snapshot IS NULL OR jsonb_typeof(p_grounding_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'grounding_snapshot must be a JSON object' USING ERRCODE = '23514';
  END IF;

  v_after := audit_mode_upsert_deliverable(
    'audit_certificate',
    p_audit_id,
    p_content,
    COALESCE(p_reason, 'Audit certificate drafted by PIQC from the audit record + protocol')
  );

  UPDATE audit_certificate_objects SET
    generation_refs    = p_generation_refs,
    grounding_snapshot = p_grounding_snapshot,
    generated_at       = NOW()
  WHERE id = (v_after->>'id')::uuid
  RETURNING to_jsonb(audit_certificate_objects.*) INTO v_after;

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants — anon revoked per the 20260727000000 precedent. The replaced
-- functions keep their existing grants (CREATE OR REPLACE preserves ACLs);
-- only the new apply RPC needs the block.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION audit_mode_apply_audit_certificate_generation(uuid, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION audit_mode_apply_audit_certificate_generation(uuid, jsonb, jsonb, jsonb, text) TO authenticated;
