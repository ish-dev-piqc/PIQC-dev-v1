-- =============================================================================
-- Audit Mode — Stage 7 LLM-authored conclusions (mirror of exec-summary, #69)
--
-- Adds provenance tracking for the conclusions text on report_draft_objects.
-- PR #62's templated prefill tagged the conclusions field "placeholder for
-- future LLM refinement"; this PR closes that deferral.
--
-- Schema shape mirrors executive_summary_source from the previous migration
-- (20260516010000) — same CHECK values, same DEFAULT semantics, same NULL =
-- preserve rule on update. The two provenance trails are independent: an
-- auditor can accept the LLM exec summary and rewrite the conclusions, or
-- vice versa, and the audit trail captures each independently.
--
-- The LLM call reuses the existing /functions/v1/audit-summary edge function
-- (extended in this PR with a `section: 'conclusions'` discriminator) — no
-- new edge function = one less dev-team deploy step.
--
-- Data-handling stance: same as exec-summary (sponsor-name-free; counts-only
-- logging; workspace observation_text IS sent to OpenAI under existing
-- precedent from supabase/functions/chat/ and dashboard-chat/).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Schema — provenance column. DEFAULT 'templated' so all existing rows
-- (including those from PR #62 prefill) backfill correctly.
-- -----------------------------------------------------------------------------
ALTER TABLE report_draft_objects
  ADD COLUMN conclusions_source TEXT NOT NULL DEFAULT 'templated'
    CHECK (conclusions_source IN ('templated', 'llm', 'auditor_edited'));


-- -----------------------------------------------------------------------------
-- Replace audit_mode_upsert_report_draft to accept the new optional param.
--
-- Same DROP-first reason as the exec-summary migration — adding a parameter
-- creates a new function signature; without the drop, the old signature
-- would silently shadow the new one for clients calling positionally.
--
-- New p_conclusions_source is OPTIONAL — when NULL, the current source is
-- preserved (saving an edit to executive_summary only doesn't flip the
-- conclusions provenance). Symmetric with p_executive_summary_source.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS audit_mode_upsert_report_draft(uuid, text, text, text, text);

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
    approved_by              = CASE WHEN v_text_changed THEN NULL ELSE approved_by END
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'executive_summary',        v_before.executive_summary,
      'conclusions',              v_before.conclusions,
      'approval_status',          v_before.approval_status,
      'executive_summary_source', v_before.executive_summary_source,
      'conclusions_source',       v_before.conclusions_source
    ),
    jsonb_build_object(
      'executive_summary',        v_after.executive_summary,
      'conclusions',              v_after.conclusions,
      'approval_status',          v_after.approval_status,
      'executive_summary_source', v_after.executive_summary_source,
      'conclusions_source',       v_after.conclusions_source
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
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_upsert_report_draft(uuid, text, text, text, text, text)
  TO authenticated;
