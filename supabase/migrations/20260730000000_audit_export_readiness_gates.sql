-- =============================================================================
-- Audit export-readiness integrity (Fable audit Theme A: A1/A2/A3 + H4).
-- Spec: plans/fable/audit-export-readiness-spec.md
--
-- Doctrine: PIQC ships close-to-final DRAFTS; in-PIQC "approval" is a
-- readiness-to-export latch at the draft boundary, never a GxP attestation.
-- The latch's one job: what exports = what the human marked ready. Today the
-- latch can lie four ways:
--   H1  all 6 approve RPCs stamp blind (UPDATE ... WHERE id = p_id, no guard)
--       — an edit landing before a stale approve gets the editor's content
--       under the approver's name.
--   H2  the advance gate list stops at stage 6 — FINAL_REVIEW_EXPORT has no
--       server gate at all.
--   H3  final_sign_off_report signs off a DRAFT (checks only idempotency).
--   H4  upsert demotes approved_* on content change but never clears
--       final_signed_off_*, and exports gate only on that flag — walk back
--       from stage 8, edit, return: export enabled on a demoted draft.
-- Plus: the report the human reviews = exec summary + conclusions + the
-- classified entry set, but entries live in another table, so post-ready
-- entry edits are invisible to every gate.
--
-- Mechanism ("assert what you saw, seal what you marked ready"):
--   (a) every approve takes p_expected_updated_at and compare-and-swaps
--       against the row's updated_at (all six tables have touch triggers).
--       NULL → MISSING_EXPECTED_VERSION; mismatch → STALE_CONTENT.
--   (b) report approve seals a server-computed readiness_fingerprint over
--       exec summary + conclusions + an entry-set digest.
--   (c) every boundary (advance to FINAL_REVIEW_EXPORT, sign-off, export
--       verify/mark) re-checks: report APPROVED, zero unclassified entries,
--       fingerprint unchanged. One shared checker = one source of truth.
--   (d) upsert also clears final_signed_off_* on content change (H4).
--
-- Signature changes require DROP first: CREATE OR REPLACE with a new param
-- list would create a PostgREST *overload*, leaving the blind stamp callable.
-- All existing error hints/ERRCODEs preserved; new hints:
--   MISSING_EXPECTED_VERSION, STALE_CONTENT, GATE_REPORT_NOT_APPROVED,
--   GATE_ENTRIES_UNCLASSIFIED, GATE_REPORT_DIVERGED,
--   GATE_REPORT_NOT_SIGNED_OFF (mark-exported only).
--
-- TS type impact: report_draft_objects.readiness_fingerprint mirrored in
-- src/types/audit/objects.ts; API result shapes carry the new hints.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fingerprint storage
-- -----------------------------------------------------------------------------
ALTER TABLE report_draft_objects ADD COLUMN readiness_fingerprint TEXT;

-- -----------------------------------------------------------------------------
-- 2. Fingerprint + readiness helpers (single source of truth for every gate)
-- -----------------------------------------------------------------------------

-- Digest of everything the reviewer sees on the report surface: the two text
-- sections plus every entry's human-visible content, ordered deterministically.
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

  RETURN md5(
    COALESCE(p_executive_summary, '') || '|' ||
    COALESCE(p_conclusions, '')       || '|' ||
    v_entries_digest
  );
END;
$$;

-- Re-checks the three readiness conditions for an audit's report. Returns an
-- empty array when ready; otherwise the GATE_* codes, most fundamental first.
CREATE OR REPLACE FUNCTION audit_mode_check_report_readiness(p_audit_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_report       report_draft_objects;
  v_unclassified integer;
  v_reasons      text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_report FROM report_draft_objects WHERE audit_id = p_audit_id;

  IF NOT FOUND OR v_report.approval_status IS DISTINCT FROM 'APPROVED' THEN
    v_reasons := array_append(v_reasons, 'GATE_REPORT_NOT_APPROVED');
  END IF;

  SELECT count(*) INTO v_unclassified
    FROM audit_workspace_entry_objects
   WHERE audit_id = p_audit_id
     AND provisional_classification = 'NOT_YET_CLASSIFIED';
  IF v_unclassified > 0 THEN
    v_reasons := array_append(v_reasons, 'GATE_ENTRIES_UNCLASSIFIED');
  END IF;

  -- Fingerprint check only applies to an approved report (an unapproved one
  -- already failed above; a missing row has NULL id).
  IF v_report.id IS NOT NULL
     AND v_report.approval_status = 'APPROVED'
     AND v_report.readiness_fingerprint IS DISTINCT FROM
         audit_mode_report_readiness_fingerprint(
           p_audit_id, v_report.executive_summary, v_report.conclusions)
  THEN
    v_reasons := array_append(v_reasons, 'GATE_REPORT_DIVERGED');
  END IF;

  RETURN v_reasons;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Approve RPCs — DROP old signatures, recreate with the CAS param.
--    Bodies are otherwise byte-equivalent to their previous definitions
--    (20260430150000 / 160000 / 170000 / 20260501010000); the CAS block is the
--    only addition, and approve_report_draft also seals the fingerprint.
-- -----------------------------------------------------------------------------
DROP FUNCTION audit_mode_approve_questionnaire(uuid, text);
DROP FUNCTION audit_mode_approve_risk_summary(uuid, text);
DROP FUNCTION audit_mode_approve_confirmation_letter(uuid, text);
DROP FUNCTION audit_mode_approve_agenda(uuid, text);
DROP FUNCTION audit_mode_approve_checklist(uuid, text);
DROP FUNCTION audit_mode_approve_report_draft(uuid, text);

CREATE FUNCTION audit_mode_approve_questionnaire(
  p_instance_id         uuid,
  p_reason              text        DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS questionnaire_instances
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_now    timestamptz := NOW();
  v_before questionnaire_instances;
  v_after  questionnaire_instances;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Approve requires the version being reviewed (expected_updated_at)'
      USING ERRCODE = '22023', HINT = 'MISSING_EXPECTED_VERSION';
  END IF;

  SELECT * INTO v_before FROM questionnaire_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Questionnaire instance % not found', p_instance_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Questionnaire changed since it was last reviewed'
      USING ERRCODE = '40001', HINT = 'STALE_CONTENT';
  END IF;

  UPDATE questionnaire_instances SET
    status       = 'COMPLETE',
    completed_at = COALESCE(completed_at, v_now),
    approved_at  = v_now,
    approved_by  = v_user
  WHERE id = p_instance_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'status',       v_before.status,
      'completed_at', v_before.completed_at,
      'approved_at',  v_before.approved_at,
      'approved_by',  v_before.approved_by
    ),
    jsonb_build_object(
      'status',       v_after.status,
      'completed_at', v_after.completed_at,
      'approved_at',  v_after.approved_at,
      'approved_by',  v_after.approved_by
    )
  );

  PERFORM audit_mode_write_delta(
    'QUESTIONNAIRE_INSTANCE'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Questionnaire approved')
  );

  RETURN v_after;
END;
$$;

CREATE FUNCTION audit_mode_approve_risk_summary(
  p_id                  uuid,
  p_reason              text        DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS vendor_risk_summary_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_now    timestamptz := NOW();
  v_before vendor_risk_summary_objects;
  v_after  vendor_risk_summary_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Approve requires the version being reviewed (expected_updated_at)'
      USING ERRCODE = '22023', HINT = 'MISSING_EXPECTED_VERSION';
  END IF;

  SELECT * INTO v_before FROM vendor_risk_summary_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Risk summary % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Risk summary changed since it was last reviewed'
      USING ERRCODE = '40001', HINT = 'STALE_CONTENT';
  END IF;

  UPDATE vendor_risk_summary_objects SET
    approval_status = 'APPROVED',
    approved_at     = v_now,
    approved_by     = v_user
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'approval_status', v_before.approval_status,
      'approved_at',     v_before.approved_at,
      'approved_by',     v_before.approved_by
    ),
    jsonb_build_object(
      'approval_status', v_after.approval_status,
      'approved_at',     v_after.approved_at,
      'approved_by',     v_after.approved_by
    )
  );

  PERFORM audit_mode_write_delta(
    'VENDOR_RISK_SUMMARY_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Risk summary approved')
  );

  RETURN v_after;
END;
$$;

CREATE FUNCTION audit_mode_approve_confirmation_letter(
  p_id                  uuid,
  p_reason              text        DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS confirmation_letter_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before confirmation_letter_objects;
  v_after  confirmation_letter_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Approve requires the version being reviewed (expected_updated_at)'
      USING ERRCODE = '22023', HINT = 'MISSING_EXPECTED_VERSION';
  END IF;

  SELECT * INTO v_before FROM confirmation_letter_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Confirmation letter % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Confirmation letter changed since it was last reviewed'
      USING ERRCODE = '40001', HINT = 'STALE_CONTENT';
  END IF;

  UPDATE confirmation_letter_objects SET
    approval_status = 'APPROVED',
    approved_at     = NOW(),
    approved_by     = v_user
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('approval_status', v_before.approval_status, 'approved_at', v_before.approved_at, 'approved_by', v_before.approved_by),
    jsonb_build_object('approval_status', v_after.approval_status,  'approved_at', v_after.approved_at,  'approved_by', v_after.approved_by)
  );

  PERFORM audit_mode_write_delta(
    'CONFIRMATION_LETTER_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Confirmation letter approved')
  );

  RETURN v_after;
END;
$$;

CREATE FUNCTION audit_mode_approve_agenda(
  p_id                  uuid,
  p_reason              text        DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS agenda_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before agenda_objects;
  v_after  agenda_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Approve requires the version being reviewed (expected_updated_at)'
      USING ERRCODE = '22023', HINT = 'MISSING_EXPECTED_VERSION';
  END IF;

  SELECT * INTO v_before FROM agenda_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agenda % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Agenda changed since it was last reviewed'
      USING ERRCODE = '40001', HINT = 'STALE_CONTENT';
  END IF;

  UPDATE agenda_objects SET
    approval_status = 'APPROVED',
    approved_at     = NOW(),
    approved_by     = v_user
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('approval_status', v_before.approval_status, 'approved_at', v_before.approved_at, 'approved_by', v_before.approved_by),
    jsonb_build_object('approval_status', v_after.approval_status,  'approved_at', v_after.approved_at,  'approved_by', v_after.approved_by)
  );

  PERFORM audit_mode_write_delta(
    'AGENDA_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Agenda approved')
  );

  RETURN v_after;
END;
$$;

CREATE FUNCTION audit_mode_approve_checklist(
  p_id                  uuid,
  p_reason              text        DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS checklist_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before checklist_objects;
  v_after  checklist_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Approve requires the version being reviewed (expected_updated_at)'
      USING ERRCODE = '22023', HINT = 'MISSING_EXPECTED_VERSION';
  END IF;

  SELECT * INTO v_before FROM checklist_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checklist % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Checklist changed since it was last reviewed'
      USING ERRCODE = '40001', HINT = 'STALE_CONTENT';
  END IF;

  UPDATE checklist_objects SET
    approval_status = 'APPROVED',
    approved_at     = NOW(),
    approved_by     = v_user
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('approval_status', v_before.approval_status, 'approved_at', v_before.approved_at, 'approved_by', v_before.approved_by),
    jsonb_build_object('approval_status', v_after.approval_status,  'approved_at', v_after.approved_at,  'approved_by', v_after.approved_by)
  );

  PERFORM audit_mode_write_delta(
    'CHECKLIST_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Checklist approved')
  );

  RETURN v_after;
END;
$$;

-- Report approve: CAS + seal. The fingerprint is computed from the row content
-- the CAS just proved the reviewer saw, plus the current entry-set digest.
CREATE FUNCTION audit_mode_approve_report_draft(
  p_id                  uuid,
  p_reason              text        DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_before      report_draft_objects;
  v_after       report_draft_objects;
  v_diff        jsonb;
  v_fingerprint text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Approve requires the version being reviewed (expected_updated_at)'
      USING ERRCODE = '22023', HINT = 'MISSING_EXPECTED_VERSION';
  END IF;

  SELECT * INTO v_before FROM report_draft_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report draft not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Report changed since it was last reviewed'
      USING ERRCODE = '40001', HINT = 'STALE_CONTENT';
  END IF;

  v_fingerprint := audit_mode_report_readiness_fingerprint(
    v_before.audit_id, v_before.executive_summary, v_before.conclusions);

  UPDATE report_draft_objects SET
    approval_status       = 'APPROVED',
    approved_at           = NOW(),
    approved_by           = v_user,
    readiness_fingerprint = v_fingerprint
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('approval_status', v_before.approval_status, 'approved_at', v_before.approved_at, 'readiness_fingerprint', v_before.readiness_fingerprint),
    jsonb_build_object('approval_status', v_after.approval_status,  'approved_at', v_after.approved_at,  'readiness_fingerprint', v_after.readiness_fingerprint)
  );

  PERFORM audit_mode_write_delta(
    'REPORT_DRAFT_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Report marked ready to export')
  );

  RETURN v_after;
END;
$$;

GRANT EXECUTE ON FUNCTION audit_mode_approve_questionnaire(uuid, text, timestamptz)        TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_approve_risk_summary(uuid, text, timestamptz)          TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_approve_confirmation_letter(uuid, text, timestamptz)   TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_approve_agenda(uuid, text, timestamptz)                TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_approve_checklist(uuid, text, timestamptz)             TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_approve_report_draft(uuid, text, timestamptz)          TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. upsert_report_draft — content change now also clears the sign-off latch
--    and the sealed fingerprint (H4). Body otherwise byte-identical to the
--    LATEST definition (20260516020000, the 6-param provenance-source version —
--    NOT the original 20260501010000 4-param one, which 20260516010000 already
--    dropped). Signature unchanged.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_upsert_report_draft(
  p_audit_id                  uuid,
  p_executive_summary         text,
  p_conclusions               text,
  p_reason                    text DEFAULT NULL,
  p_executive_summary_source  text DEFAULT NULL,
  p_conclusions_source        text DEFAULT NULL
)
RETURNS report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user                  uuid := auth.uid();
  v_before                report_draft_objects;
  v_after                 report_draft_objects;
  v_diff                  jsonb;
  v_text_changed          boolean := FALSE;
  v_new_exec_source       text;
  v_new_conclusions_source text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_executive_summary_source IS NOT NULL
     AND p_executive_summary_source NOT IN ('templated', 'llm', 'auditor_edited') THEN
    RAISE EXCEPTION 'Invalid executive_summary_source: %', p_executive_summary_source
      USING ERRCODE = '23514';
  END IF;

  IF p_conclusions_source IS NOT NULL
     AND p_conclusions_source NOT IN ('templated', 'llm', 'auditor_edited') THEN
    RAISE EXCEPTION 'Invalid conclusions_source: %', p_conclusions_source
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_before FROM report_draft_objects WHERE audit_id = p_audit_id;

  IF NOT FOUND THEN
    -- Fresh insert. Default sources to 'auditor_edited' if the caller is
    -- driving a manual create (no prefill ran first), or honour whatever
    -- the client explicitly sent for each field.
    v_new_exec_source        := COALESCE(p_executive_summary_source, 'auditor_edited');
    v_new_conclusions_source := COALESCE(p_conclusions_source,       'auditor_edited');

    INSERT INTO report_draft_objects (
      audit_id, executive_summary, conclusions, approval_status,
      executive_summary_source, conclusions_source
    )
    VALUES (
      p_audit_id, p_executive_summary, p_conclusions, 'DRAFT',
      v_new_exec_source, v_new_conclusions_source
    )
    RETURNING * INTO v_after;

    PERFORM audit_mode_write_delta(
      'REPORT_DRAFT_OBJECT'::tracked_object_type,
      v_after.id,
      jsonb_build_object(
        'executive_summary',        jsonb_build_object('from', NULL, 'to', v_after.executive_summary),
        'conclusions',              jsonb_build_object('from', NULL, 'to', v_after.conclusions),
        'approval_status',          jsonb_build_object('from', NULL, 'to', v_after.approval_status),
        'executive_summary_source', jsonb_build_object('from', NULL, 'to', v_after.executive_summary_source),
        'conclusions_source',       jsonb_build_object('from', NULL, 'to', v_after.conclusions_source)
      ),
      v_user,
      COALESCE(p_reason, 'Report draft created')
    );
    RETURN v_after;
  END IF;

  v_text_changed := (v_before.executive_summary IS DISTINCT FROM p_executive_summary)
                 OR (v_before.conclusions IS DISTINCT FROM p_conclusions);

  -- Source resolution (symmetric): explicit caller value wins, NULL preserves.
  v_new_exec_source        := COALESCE(p_executive_summary_source, v_before.executive_summary_source);
  v_new_conclusions_source := COALESCE(p_conclusions_source,       v_before.conclusions_source);

  UPDATE report_draft_objects SET
    executive_summary        = p_executive_summary,
    conclusions              = p_conclusions,
    executive_summary_source = v_new_exec_source,
    conclusions_source       = v_new_conclusions_source,
    approval_status          = CASE WHEN v_text_changed THEN 'DRAFT'::deliverable_approval_status
                                    ELSE approval_status END,
    approved_at              = CASE WHEN v_text_changed THEN NULL ELSE approved_at END,
    approved_by              = CASE WHEN v_text_changed THEN NULL ELSE approved_by END,
    readiness_fingerprint    = CASE WHEN v_text_changed THEN NULL ELSE readiness_fingerprint END,
    final_signed_off_at      = CASE WHEN v_text_changed THEN NULL ELSE final_signed_off_at END,
    final_signed_off_by      = CASE WHEN v_text_changed THEN NULL ELSE final_signed_off_by END
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'executive_summary',        v_before.executive_summary,
      'conclusions',              v_before.conclusions,
      'approval_status',          v_before.approval_status,
      'executive_summary_source', v_before.executive_summary_source,
      'conclusions_source',       v_before.conclusions_source,
      'final_signed_off_at',      v_before.final_signed_off_at
    ),
    jsonb_build_object(
      'executive_summary',        v_after.executive_summary,
      'conclusions',              v_after.conclusions,
      'approval_status',          v_after.approval_status,
      'executive_summary_source', v_after.executive_summary_source,
      'conclusions_source',       v_after.conclusions_source,
      'final_signed_off_at',      v_after.final_signed_off_at
    )
  );

  IF v_diff <> '{}'::jsonb THEN
    PERFORM audit_mode_write_delta(
      'REPORT_DRAFT_OBJECT'::tracked_object_type,
      v_after.id,
      v_diff,
      v_user,
      p_reason
    );
  END IF;

  RETURN v_after;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Sign-off + export-mark — gated on readiness. Idempotency preserved.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_final_sign_off_report(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_before  report_draft_objects;
  v_after   report_draft_objects;
  v_diff    jsonb;
  v_reasons text[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM report_draft_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report draft not found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency guard: don't overwrite an existing sign-off timestamp.
  IF v_before.final_signed_off_at IS NOT NULL THEN
    RETURN v_before;
  END IF;

  v_reasons := audit_mode_check_report_readiness(v_before.audit_id);
  IF array_length(v_reasons, 1) > 0 THEN
    RAISE EXCEPTION 'Cannot sign off: report is not ready (%)', array_to_string(v_reasons, ', ')
      USING ERRCODE = '42501', HINT = v_reasons[1];
  END IF;

  UPDATE report_draft_objects SET
    final_signed_off_at = NOW(),
    final_signed_off_by = v_user
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('final_signed_off_at', v_before.final_signed_off_at),
    jsonb_build_object('final_signed_off_at', v_after.final_signed_off_at)
  );

  PERFORM audit_mode_write_delta(
    'REPORT_DRAFT_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Audit final sign-off')
  );

  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION audit_mode_mark_report_exported(
  p_id uuid
)
RETURNS report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_before report_draft_objects;
  v_after report_draft_objects;
  v_diff  jsonb;
  v_reasons text[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM report_draft_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report draft not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_before.final_signed_off_at IS NULL THEN
    RAISE EXCEPTION 'Cannot record export: report is not signed off'
      USING ERRCODE = '42501', HINT = 'GATE_REPORT_NOT_SIGNED_OFF';
  END IF;

  v_reasons := audit_mode_check_report_readiness(v_before.audit_id);
  IF array_length(v_reasons, 1) > 0 THEN
    RAISE EXCEPTION 'Cannot record export: report is not ready (%)', array_to_string(v_reasons, ', ')
      USING ERRCODE = '42501', HINT = v_reasons[1];
  END IF;

  UPDATE report_draft_objects SET
    exported_at = NOW()
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('exported_at', v_before.exported_at),
    jsonb_build_object('exported_at', v_after.exported_at)
  );

  PERFORM audit_mode_write_delta(
    'REPORT_DRAFT_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    'Report exported'
  );

  RETURN v_after;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Export readiness probe — called by the export buttons before generating,
--    so the client-side blob is built only from verified-fresh state.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_verify_export_readiness(p_audit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_reasons text[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_reasons := audit_mode_check_report_readiness(p_audit_id);
  RETURN jsonb_build_object(
    'ready',   COALESCE(array_length(v_reasons, 1), 0) = 0,
    'reasons', to_jsonb(v_reasons)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION audit_mode_report_readiness_fingerprint(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_check_report_readiness(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_verify_export_readiness(uuid)                   TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Advance RPC — add the FINAL_REVIEW_EXPORT gate. Body otherwise
--    byte-identical to 20260721000100 (SECURITY DEFINER + column lockdown era);
--    all existing hints and ERRCODEs preserved.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_advance_audit_stage(
  p_audit_id uuid,
  p_to_stage audit_stage,
  p_reason   text DEFAULT NULL
)
RETURNS audits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user                       uuid := auth.uid();
  v_before                     audits;
  v_after                      audits;
  v_from_idx                   integer;
  v_to_idx                     integer;
  v_questionnaire_approved_at  timestamptz;
  v_risk_summary_status        risk_summary_approval_status;
  v_letter_status              deliverable_approval_status;
  v_agenda_status              deliverable_approval_status;
  v_checklist_status           deliverable_approval_status;
  v_blocked                    text[] := ARRAY[]::text[];
  v_readiness_reasons          text[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  -- SECURITY DEFINER bypasses RLS; reproduce the INVOKER-era visibility rule
  -- explicitly. Same error as the not-found branch — no existence leak.
  IF v_before.lead_auditor_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  IF v_before.current_stage = p_to_stage THEN
    RAISE EXCEPTION 'Audit is already at stage %', p_to_stage USING ERRCODE = '22023';
  END IF;

  v_from_idx := audit_mode_stage_index(v_before.current_stage);
  v_to_idx   := audit_mode_stage_index(p_to_stage);

  -- Fail closed: an unmapped stage (any ISA_* value — audit_mode_stage_index
  -- does not map these) must never bypass the ordering/gate checks by making the
  -- forward comparison NULL. Reject rather than fall through to the UPDATE.
  IF v_from_idx IS NULL OR v_to_idx IS NULL THEN
    RAISE EXCEPTION 'Stage transition not permitted: % → % is not in the advancement map',
      v_before.current_stage, p_to_stage
      USING ERRCODE = '22023', HINT = 'STAGE_NOT_IN_ADVANCEMENT_MAP';
  END IF;

  -- Forward: must move exactly +1 and gate must pass.
  IF v_to_idx > v_from_idx THEN
    IF v_to_idx - v_from_idx <> 1 THEN
      RAISE EXCEPTION 'Forward transitions must move exactly one stage (% → %)',
        v_before.current_stage, p_to_stage USING ERRCODE = '22023';
    END IF;

    -- Gate: PRE_AUDIT_DRAFTING needs questionnaire + risk summary approved.
    IF p_to_stage = 'PRE_AUDIT_DRAFTING' THEN
      SELECT qi.approved_at  INTO v_questionnaire_approved_at FROM questionnaire_instances qi WHERE qi.audit_id = p_audit_id;
      SELECT rs.approval_status INTO v_risk_summary_status     FROM vendor_risk_summary_objects rs WHERE rs.audit_id = p_audit_id;
      IF v_questionnaire_approved_at IS NULL THEN
        RAISE EXCEPTION 'Cannot enter PRE_AUDIT_DRAFTING: questionnaire is not approved'
          USING ERRCODE = '42501', HINT = 'GATE_QUESTIONNAIRE_NOT_APPROVED';
      END IF;
      IF v_risk_summary_status IS DISTINCT FROM 'APPROVED' THEN
        RAISE EXCEPTION 'Cannot enter PRE_AUDIT_DRAFTING: vendor risk summary is not approved'
          USING ERRCODE = '42501', HINT = 'GATE_RISK_SUMMARY_NOT_APPROVED';
      END IF;
    END IF;

    -- Gate: AUDIT_CONDUCT needs all three deliverables approved.
    IF p_to_stage = 'AUDIT_CONDUCT' THEN
      SELECT cl.approval_status INTO v_letter_status    FROM confirmation_letter_objects cl WHERE cl.audit_id = p_audit_id;
      SELECT ag.approval_status INTO v_agenda_status    FROM agenda_objects ag             WHERE ag.audit_id = p_audit_id;
      SELECT ch.approval_status INTO v_checklist_status FROM checklist_objects ch          WHERE ch.audit_id = p_audit_id;

      IF v_letter_status    IS NULL OR v_letter_status    <> 'APPROVED' THEN v_blocked := array_append(v_blocked, 'confirmation_letter'); END IF;
      IF v_agenda_status    IS NULL OR v_agenda_status    <> 'APPROVED' THEN v_blocked := array_append(v_blocked, 'agenda');              END IF;
      IF v_checklist_status IS NULL OR v_checklist_status <> 'APPROVED' THEN v_blocked := array_append(v_blocked, 'checklist');           END IF;
      IF array_length(v_blocked, 1) > 0 THEN
        RAISE EXCEPTION 'Cannot enter AUDIT_CONDUCT: deliverables not approved (%)', array_to_string(v_blocked, ', ')
          USING ERRCODE = '42501', HINT = 'GATE_DELIVERABLES_NOT_APPROVED';
      END IF;
    END IF;

    -- Gate: FINAL_REVIEW_EXPORT needs the report marked ready (approved), all
    -- entries classified, and content unchanged since the ready-mark. The
    -- readiness checker is SECURITY INVOKER but runs here under DEFINER —
    -- that's correct: the lead-auditor ownership check above already scoped
    -- access, and the checker only reads this audit's rows.
    IF p_to_stage = 'FINAL_REVIEW_EXPORT' THEN
      v_readiness_reasons := audit_mode_check_report_readiness(p_audit_id);
      IF array_length(v_readiness_reasons, 1) > 0 THEN
        RAISE EXCEPTION 'Cannot enter FINAL_REVIEW_EXPORT: report is not ready (%)',
          array_to_string(v_readiness_reasons, ', ')
          USING ERRCODE = '42501', HINT = v_readiness_reasons[1];
      END IF;
    END IF;
  END IF;
  -- Backward (v_to_idx < v_from_idx): allowed, no gate.

  UPDATE audits SET current_stage = p_to_stage WHERE id = p_audit_id RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'AUDIT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'current_stage', jsonb_build_object('from', v_before.current_stage, 'to', v_after.current_stage)
    ),
    v_user,
    p_reason
  );

  RETURN v_after;
END;
$$;

GRANT EXECUTE ON FUNCTION audit_mode_advance_audit_stage(uuid, audit_stage, text) TO authenticated;
