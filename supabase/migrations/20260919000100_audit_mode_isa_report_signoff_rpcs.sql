-- =============================================================================
-- Audit Mode — ISA report sign-off + verified export RPCs (isa-review-export)
--
-- Five NEW functions (nothing applied is replaced):
--
--   audit_mode_isa_report_readiness_fingerprint(p_audit_id) → text
--       md5 over everything the exported report renders from stored state:
--       the four prose columns, the verdict and its nuance, the response
--       clause parameters, a digest of every finding and of the positive
--       notes. Derived content (rollups, boilerplate) is not stored and so
--       not sealed — it is a pure function of what is.
--   audit_mode_check_isa_report_readiness(p_audit_id) → text[]
--       the one checker every boundary runs; empty = ready. Codes, most
--       fundamental first: GATE_ISA_VERDICT_NOT_SET,
--       GATE_ISA_REPORT_NOT_SIGNED_OFF, GATE_ISA_REPORT_DIVERGED.
--   audit_mode_final_sign_off_isa_report(p_id, p_expected_updated_at, p_reason)
--       the latch: CAS on updated_at (22023 MISSING_EXPECTED_VERSION / 40001
--       STALE_CONTENT — the generic approve's codes, 20260906000100), the
--       verdict required (42501 GATE_ISA_VERDICT_NOT_SET), seals the
--       fingerprint. Re-seals when the content changed since an earlier
--       sign-off (and clears exported_at — "Exported" must never describe
--       content that changed); idempotent when it did not. Delta per seal.
--   audit_mode_mark_isa_report_exported(p_id, p_artifact)
--       records exported_at; refuses unless the checker is empty (42501 +
--       the first code as HINT). The delta names the artefact.
--   audit_mode_verify_isa_export_readiness(p_audit_id) → jsonb {ready, reasons}
--       the client's pre-export probe — and its not-applied probe (PGRST202).
--
-- Mirror of the vendor mechanism in 20260730000000 ("assert what you saw,
-- seal what you marked ready, verify at every boundary crossing") with the
-- ISA report's own precondition — the site verdict — as the only content
-- gate. One latch, not two: see 20260919000000.
--
-- All SECURITY INVOKER: isa_report_draft_objects, isa_finding_objects and
-- audit_note_objects are RLS'd to the lead auditor already; the delta write
-- passes audit_mode_can_view_tracked_object's ISA_REPORT_DRAFT_OBJECT branch
-- (20260725000100). Grants per 20260911000000. Owner: @rv61.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fingerprint — single source of truth for "what the reviewer saw"
-- -----------------------------------------------------------------------------
CREATE FUNCTION audit_mode_isa_report_readiness_fingerprint(p_audit_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_draft    isa_report_draft_objects;
  v_findings text;
  v_notes    text;
BEGIN
  SELECT * INTO v_draft FROM isa_report_draft_objects WHERE audit_id = p_audit_id;

  -- Every human-visible field of every finding, ordered deterministically.
  -- jsonb::text is canonical (keys sorted), so evidence / protocol_refs
  -- digest stably.
  SELECT md5(COALESCE(string_agg(
           f.id::text
             || '|' || f.title
             || '|' || f.isa_domain::text
             || '|' || COALESCE(f.subcategory, '')
             || '|' || f.severity::text
             || '|' || f.observation
             || '|' || f.evidence::text
             || '|' || COALESCE(f.reference, '')
             || '|' || f.protocol_refs::text
             || '|' || f.response_owner::text,
           '~' ORDER BY f.id), ''))
    INTO v_findings
    FROM isa_finding_objects f
   WHERE f.audit_id = p_audit_id;

  -- Positive observations render in the report; soft-deleted notes do not.
  SELECT md5(COALESCE(string_agg(n.id::text || '|' || n.body, '~' ORDER BY n.id), ''))
    INTO v_notes
    FROM audit_note_objects n
   WHERE n.audit_id = p_audit_id
     AND n.is_positive
     AND n.deleted_at IS NULL;

  RETURN md5(
    COALESCE(v_draft.exec_summary, '')            || '|' ||
    COALESCE(v_draft.auditee_background, '')      || '|' ||
    COALESCE(v_draft.opening_meeting, '')         || '|' ||
    COALESCE(v_draft.closing_meeting, '')         || '|' ||
    COALESCE(v_draft.site_verdict::text, '')      || '|' ||
    COALESCE(v_draft.site_verdict_text, '')       || '|' ||
    COALESCE(v_draft.response_due_days::text, '') || '|' ||
    COALESCE(v_draft.response_due_basis, '')      || '|' ||
    v_findings || '|' || v_notes
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Readiness checker — empty array = ready; codes most fundamental first
-- -----------------------------------------------------------------------------
CREATE FUNCTION audit_mode_check_isa_report_readiness(p_audit_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_draft   isa_report_draft_objects;
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_draft FROM isa_report_draft_objects WHERE audit_id = p_audit_id;

  IF NOT FOUND OR v_draft.site_verdict IS NULL THEN
    v_reasons := array_append(v_reasons, 'GATE_ISA_VERDICT_NOT_SET');
  END IF;

  IF v_draft.id IS NULL OR v_draft.final_signed_off_at IS NULL THEN
    v_reasons := array_append(v_reasons, 'GATE_ISA_REPORT_NOT_SIGNED_OFF');
  ELSIF v_draft.readiness_fingerprint IS DISTINCT FROM
        audit_mode_isa_report_readiness_fingerprint(p_audit_id) THEN
    v_reasons := array_append(v_reasons, 'GATE_ISA_REPORT_DIVERGED');
  END IF;

  RETURN v_reasons;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Sign-off — the latch
-- -----------------------------------------------------------------------------
CREATE FUNCTION audit_mode_final_sign_off_isa_report(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_reason              text DEFAULT NULL
)
RETURNS isa_report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_before      isa_report_draft_objects;
  v_after       isa_report_draft_objects;
  v_fingerprint text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Sign-off requires the version you reviewed (expected_updated_at)'
      USING ERRCODE = '22023', HINT = 'MISSING_EXPECTED_VERSION';
  END IF;

  -- FOR UPDATE serializes against the upsert's row UPDATE, so the CAS and
  -- the fingerprint below run on locked truth. (Finding / note edits are
  -- not row-locked here; a racing change persists as a fingerprint mismatch
  -- and every later boundary catches it.)
  SELECT * INTO v_before FROM isa_report_draft_objects WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report draft not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'The report changed since you reviewed it'
      USING ERRCODE = '40001', HINT = 'STALE_CONTENT';
  END IF;

  IF v_before.site_verdict IS NULL THEN
    RAISE EXCEPTION 'Cannot sign off: the site continuation verdict is not set'
      USING ERRCODE = '42501', HINT = 'GATE_ISA_VERDICT_NOT_SET';
  END IF;

  v_fingerprint := audit_mode_isa_report_readiness_fingerprint(v_before.audit_id);

  -- Idempotent: the sealed version is the current one.
  IF v_before.final_signed_off_at IS NOT NULL
     AND v_before.readiness_fingerprint = v_fingerprint THEN
    RETURN v_before;
  END IF;

  UPDATE isa_report_draft_objects SET
    final_signed_off_at   = NOW(),
    final_signed_off_by   = v_user,
    readiness_fingerprint = v_fingerprint,
    exported_at           = NULL
  WHERE id = p_id
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'ISA_REPORT_DRAFT_OBJECT'::tracked_object_type,
    v_after.id,
    audit_mode_diff_jsonb(
      jsonb_build_object('final_signed_off_at', v_before.final_signed_off_at,
                         'exported_at',         v_before.exported_at),
      jsonb_build_object('final_signed_off_at', v_after.final_signed_off_at,
                         'exported_at',         v_after.exported_at)
    ),
    v_user,
    COALESCE(p_reason,
             CASE WHEN v_before.final_signed_off_at IS NULL
                  THEN 'Site audit report signed off'
                  ELSE 'Site audit report signed off again after changes' END)
  );

  RETURN v_after;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Mark exported — gated on the checker, names the artefact
-- -----------------------------------------------------------------------------
CREATE FUNCTION audit_mode_mark_isa_report_exported(
  p_id       uuid,
  p_artifact text
)
RETURNS isa_report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_before  isa_report_draft_objects;
  v_after   isa_report_draft_objects;
  v_reasons text[];
  v_label   text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_label := CASE p_artifact
    WHEN 'report_docx'           THEN 'report .docx'
    WHEN 'observation_form_docx' THEN 'observation form .docx'
    WHEN 'clipboard'             THEN 'clipboard'
  END;
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'artifact must be report_docx, observation_form_docx or clipboard'
      USING ERRCODE = '22023';
  END IF;

  -- FOR UPDATE: same locked-truth rationale as the sign-off.
  SELECT * INTO v_before FROM isa_report_draft_objects WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report draft not found' USING ERRCODE = 'P0002';
  END IF;

  v_reasons := audit_mode_check_isa_report_readiness(v_before.audit_id);
  IF array_length(v_reasons, 1) > 0 THEN
    RAISE EXCEPTION 'Cannot record export: report is not ready (%)',
      array_to_string(v_reasons, ', ')
      USING ERRCODE = '42501', HINT = v_reasons[1];
  END IF;

  UPDATE isa_report_draft_objects SET
    exported_at = NOW()
  WHERE id = p_id
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'ISA_REPORT_DRAFT_OBJECT'::tracked_object_type,
    v_after.id,
    audit_mode_diff_jsonb(
      jsonb_build_object('exported_at', v_before.exported_at),
      jsonb_build_object('exported_at', v_after.exported_at)
    ),
    v_user,
    'Site audit report exported (' || v_label || ')'
  );

  RETURN v_after;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Export readiness probe — the client calls it before generating, so the
--    blob is built only from verified-fresh state
-- -----------------------------------------------------------------------------
CREATE FUNCTION audit_mode_verify_isa_export_readiness(p_audit_id uuid)
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

  v_reasons := audit_mode_check_isa_report_readiness(p_audit_id);
  RETURN jsonb_build_object(
    'ready',   COALESCE(array_length(v_reasons, 1), 0) = 0,
    'reasons', to_jsonb(v_reasons)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Grants (20260911000000 pattern)
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.audit_mode_isa_report_readiness_fingerprint(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_mode_isa_report_readiness_fingerprint(uuid)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.audit_mode_check_isa_report_readiness(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_mode_check_isa_report_readiness(uuid)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.audit_mode_final_sign_off_isa_report(uuid, timestamptz, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_mode_final_sign_off_isa_report(uuid, timestamptz, text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.audit_mode_mark_isa_report_exported(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_mode_mark_isa_report_exported(uuid, text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.audit_mode_verify_isa_export_readiness(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_mode_verify_isa_export_readiness(uuid)
  TO authenticated, service_role;
