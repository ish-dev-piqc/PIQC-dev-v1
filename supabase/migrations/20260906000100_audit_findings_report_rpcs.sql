-- =============================================================================
-- Audit Mode — findings report: RPC slice (PR-D4)
--
-- Companion to 20260906000000 (enum value + table). Split so the new
-- tracked_object_type value is never referenced in the transaction that added
-- it (20260707000200 precedent).
--
-- Carries the GENERIC deliverable lifecycle pair the D3 ledger scheduled for
-- "the 6th kind": audit_mode_upsert_deliverable / audit_mode_approve_deliverable
-- dispatch on a kind→table whitelist instead of adding a 4th verbatim clone of
-- the upsert/approve bodies. findings_report is the first (and so far only)
-- caller — the five existing kinds keep their per-kind RPCs and clients
-- unchanged; migrating them onto the pair is the partner's-return rework.
--
-- The findings report's latch has TWO pins, because its document is narrative
-- (stored) + observation blocks (derived live from audit_workspace_entry_objects):
--   - updated_at CAS      → the narrative the reviewer saw (standard)
--   - entry-set digest CAS → WHICH entry set the reviewer saw (new; the digest
--     expression is extracted from audit_mode_report_readiness_fingerprint,
--     which now delegates to it — byte-identical digest, so every fingerprint
--     sealed before this migration still verifies)
-- The verified digest is sealed into basis_digest; demote-on-edit clears it.
-- A digest check→update window exists for concurrent entry edits (entries
-- live in another table, so the row CAS cannot cover them); the divergence
-- re-check (client compares live digest vs basis_digest) is the honest guard
-- for anything that lands after approve — same doctrine as
-- audit_mode_check_report_readiness's GATE_REPORT_DIVERGED.
--
-- Plus audit_mode_can_view_tracked_object replaced in full, adding the
-- FINDINGS_REPORT_OBJECT branch (every branch from its latest version in
-- 20260905000100 kept; behavior for existing types unchanged).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Entry-set digest — extracted from audit_mode_report_readiness_fingerprint.
-- The expression is BYTE-IDENTICAL to the inline original (20260730000000);
-- both the readiness fingerprint and the findings-report basis pin read it.
-- SECURITY INVOKER: under RLS a non-owner sees zero rows and gets the empty-
-- set digest — harmless, since only the owner can approve anything with it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_entry_set_digest(p_audit_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_entries_digest text;
BEGIN
  SELECT md5(COALESCE(string_agg(
           e.id::text
             || '|' || e.vendor_domain
             || '|' || e.observation_text
             || '|' || COALESCE(e.checkpoint_ref, '')
             || '|' || e.provisional_impact::text
             || '|' || e.provisional_classification::text,
           '~' ORDER BY e.id), ''))
    INTO v_entries_digest
    FROM audit_workspace_entry_objects e
   WHERE e.audit_id = p_audit_id;

  RETURN v_entries_digest;
END;
$$;

-- Delegation only — the fingerprint's inputs, hashing, and output are
-- unchanged (the entry-digest expression moved into the helper above).
CREATE OR REPLACE FUNCTION audit_mode_report_readiness_fingerprint(
  p_audit_id          uuid,
  p_executive_summary text,
  p_conclusions       text
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN md5(
    COALESCE(p_executive_summary, '') || '|' ||
    COALESCE(p_conclusions, '')       || '|' ||
    audit_mode_entry_set_digest(p_audit_id)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_can_view_tracked_object — full replacement adding the
-- FINDINGS_REPORT_OBJECT branch.
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
-- Kind whitelist — the ONE place the generic pair resolves a deliverable kind
-- to its table, tracked type, human noun, and basis pin. Dynamic SQL below
-- only ever interpolates o_table via %I, and o_table only ever comes from
-- this CASE — no caller-controlled identifier reaches EXECUTE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_deliverable_kind_config(
  p_kind    text,
  OUT o_table   text,
  OUT o_tracked tracked_object_type,
  OUT o_noun    text,
  OUT o_basis   text  -- NULL, or 'ENTRY_SET' (approve pins the entry-set digest)
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
    ELSE
      RAISE EXCEPTION 'Unknown deliverable kind %', p_kind USING ERRCODE = '22023';
  END CASE;
END;
$$;


-- -----------------------------------------------------------------------------
-- Generic upsert — demote-on-edit, identical semantics to the per-kind clones
-- (20260905000100 is the reference body): content change → DRAFT, approval
-- cleared, approved_at/approved_by in the demote diff; readable deltas via
-- audit_mode_write_delta under the kind's tracked type. Basis kinds also
-- clear basis_digest on content change (the seal describes the voided
-- approval) and carry it in the diff. Returns the full row as jsonb — a
-- polymorphic RETURNS can't span six row types.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_upsert_deliverable(
  p_kind     text,
  p_audit_id uuid,
  p_content  jsonb,
  p_reason   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user            uuid := auth.uid();
  v_cfg             record;
  v_before          jsonb;
  v_after           jsonb;
  v_diff            jsonb;
  v_content_changed boolean := FALSE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM audit_mode_deliverable_kind_config(p_kind);

  -- FOR UPDATE: the per-kind clones read their before-image unlocked, so a
  -- concurrent save/approve between snapshot and UPDATE could compute
  -- v_content_changed against a row that was no longer current (an approve
  -- landing in that window survived over content it never covered, and the
  -- delta diff went quiet). Locking here serializes writers per row — the
  -- generic pair is the one place the fix covers every kind at once.
  EXECUTE format('SELECT to_jsonb(t.*) FROM %I t WHERE t.audit_id = $1 FOR UPDATE', v_cfg.o_table)
    INTO v_before USING p_audit_id;

  IF v_before IS NULL THEN
    EXECUTE format(
      'INSERT INTO %I (audit_id, content, approval_status)
       VALUES ($1, $2, ''DRAFT'') RETURNING to_jsonb(%I.*)',
      v_cfg.o_table, v_cfg.o_table)
      INTO v_after USING p_audit_id, p_content;

    PERFORM audit_mode_write_delta(
      v_cfg.o_tracked,
      (v_after->>'id')::uuid,
      jsonb_build_object(
        'content',         jsonb_build_object('from', NULL, 'to', v_after->'content'),
        'approval_status', jsonb_build_object('from', NULL, 'to', v_after->'approval_status')
      ),
      v_user,
      COALESCE(p_reason, v_cfg.o_noun || ' created')
    );
    RETURN v_after;
  END IF;

  v_content_changed := (v_before->'content') IS DISTINCT FROM p_content;

  IF v_cfg.o_basis IS NOT NULL THEN
    EXECUTE format(
      'UPDATE %I SET
         content         = $2,
         approval_status = CASE WHEN $3 THEN ''DRAFT''::deliverable_approval_status ELSE approval_status END,
         approved_at     = CASE WHEN $3 THEN NULL ELSE approved_at END,
         approved_by     = CASE WHEN $3 THEN NULL ELSE approved_by END,
         basis_digest    = CASE WHEN $3 THEN NULL ELSE basis_digest END
       WHERE id = $1 RETURNING to_jsonb(%I.*)',
      v_cfg.o_table, v_cfg.o_table)
      INTO v_after USING (v_before->>'id')::uuid, p_content, v_content_changed;
  ELSE
    EXECUTE format(
      'UPDATE %I SET
         content         = $2,
         approval_status = CASE WHEN $3 THEN ''DRAFT''::deliverable_approval_status ELSE approval_status END,
         approved_at     = CASE WHEN $3 THEN NULL ELSE approved_at END,
         approved_by     = CASE WHEN $3 THEN NULL ELSE approved_by END
       WHERE id = $1 RETURNING to_jsonb(%I.*)',
      v_cfg.o_table, v_cfg.o_table)
      INTO v_after USING (v_before->>'id')::uuid, p_content, v_content_changed;
  END IF;

  -- approved_at/approved_by in the demote diff (20260904000100 precedent):
  -- when a demote voids an approval, the trail records WHOSE approval cleared.
  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'content',         v_before->'content',
      'approval_status', v_before->'approval_status',
      'approved_at',     v_before->'approved_at',
      'approved_by',     v_before->'approved_by'
    ) || CASE WHEN v_cfg.o_basis IS NOT NULL
         THEN jsonb_build_object('basis_digest', v_before->'basis_digest')
         ELSE '{}'::jsonb END,
    jsonb_build_object(
      'content',         v_after->'content',
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
    COALESCE(p_reason, CASE WHEN v_content_changed
      THEN v_cfg.o_noun || ' edited (auto-demoted to DRAFT)' ELSE NULL END)
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Generic approve — updated_at CAS (the narrative the reviewer saw) plus, for
-- basis kinds, the entry-set digest CAS (WHICH derived basis they saw). The
-- verified digest is sealed into basis_digest in the same UPDATE.
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
  ELSIF p_expected_basis_digest IS NOT NULL THEN
    -- A basis pin passed for a kind that declares none is a caller bug, and
    -- silently ignoring it would read as protection that quietly isn't there
    -- (the trap for the day the five legacy kinds migrate onto this pair).
    RAISE EXCEPTION 'Deliverable kind % declares no approval basis — expected_basis_digest must not be passed', p_kind
      USING ERRCODE = '22023';
  END IF;

  -- Atomic CAS in the UPDATE predicate (see approve_confirmation_letter).
  -- Basis kinds seal the verified digest in the same statement; a concurrent
  -- entry edit between the digest check above and this UPDATE is caught by
  -- the divergence re-check (live digest vs basis_digest), not here.
  -- Gated on the SAME token as the verification block above — a future basis
  -- token must extend both together, or it could seal a digest it never
  -- verified (extend the verification, this arm, and the upsert's clear).
  IF v_cfg.o_basis = 'ENTRY_SET' THEN
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
CREATE OR REPLACE FUNCTION audit_mode_apply_findings_report_generation(
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
    'findings_report',
    p_audit_id,
    p_content,
    COALESCE(p_reason, 'Findings report narrative drafted by PIQC from the audit observations + protocol')
  );

  UPDATE findings_report_objects SET
    generation_refs    = p_generation_refs,
    grounding_snapshot = p_grounding_snapshot,
    generated_at       = NOW()
  WHERE id = (v_after->>'id')::uuid
  RETURNING to_jsonb(findings_report_objects.*) INTO v_after;

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants — anon revoked per the 20260727000000 precedent for data-returning
-- helpers (the write RPCs already fail closed on auth.uid(), but the posture
-- should not depend on it). audit_mode_deliverable_kind_config keeps default
-- EXECUTE like diff_jsonb/write_delta: the INVOKER functions above call it as
-- the caller's role.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION audit_mode_entry_set_digest(uuid)                                             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION audit_mode_upsert_deliverable(text, uuid, jsonb, text)                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION audit_mode_approve_deliverable(text, uuid, text, timestamptz, text)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION audit_mode_apply_findings_report_generation(uuid, jsonb, jsonb, jsonb, text)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION audit_mode_entry_set_digest(uuid)                                              TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_upsert_deliverable(text, uuid, jsonb, text)                         TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_approve_deliverable(text, uuid, text, timestamptz, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_apply_findings_report_generation(uuid, jsonb, jsonb, jsonb, text)   TO authenticated;
