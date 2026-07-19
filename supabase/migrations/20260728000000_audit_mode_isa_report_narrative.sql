-- =============================================================================
-- Audit Mode — ISA report narrative provenance (S5 of the notes → findings →
-- report arc)
--
-- The S3 schema deliberately shipped without *_source columns: with no LLM in
-- that slice, NULL-ness encoded the only two states (NULL = templated,
-- stored = auditor took the pen). Its header reserved this migration: "when
-- LLM refinement lands, a source column comes with it." It lands here.
--
-- Four source columns, one per prose section, on the vendor lane's ladder:
--   NULL             — prose column is NULL, section renders templated
--   'llm'            — PIQC-drafted text applied verbatim by the auditor
--   'auditor_edited' — the auditor wrote or edited the text
-- Coherence is CHECK-enforced: a source exists exactly when its prose does.
-- Existing stored prose predates the LLM path and is backfilled
-- 'auditor_edited' (the only way prose could exist before this migration).
--
-- The upsert RPC is replaced DROP-first (the signature changes; CREATE OR
-- REPLACE with new params would create an ambiguous overload). Source
-- semantics in the RPC: writing a prose field sets its source to
-- COALESCE(p_*_source, 'auditor_edited') — the apply path passes 'llm', every
-- manual save omits it and lands 'auditor_edited'. Clearing a section nulls
-- both. Source flips are delta-tracked like any other change.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Columns + backfill + coherence
-- -----------------------------------------------------------------------------
ALTER TABLE isa_report_draft_objects
  ADD COLUMN exec_summary_source       TEXT CHECK (exec_summary_source       IN ('llm', 'auditor_edited')),
  ADD COLUMN auditee_background_source TEXT CHECK (auditee_background_source IN ('llm', 'auditor_edited')),
  ADD COLUMN opening_meeting_source    TEXT CHECK (opening_meeting_source    IN ('llm', 'auditor_edited')),
  ADD COLUMN closing_meeting_source    TEXT CHECK (closing_meeting_source    IN ('llm', 'auditor_edited'));

UPDATE isa_report_draft_objects SET
  exec_summary_source       = CASE WHEN exec_summary       IS NOT NULL THEN 'auditor_edited' END,
  auditee_background_source = CASE WHEN auditee_background IS NOT NULL THEN 'auditor_edited' END,
  opening_meeting_source    = CASE WHEN opening_meeting    IS NOT NULL THEN 'auditor_edited' END,
  closing_meeting_source    = CASE WHEN closing_meeting    IS NOT NULL THEN 'auditor_edited' END;

ALTER TABLE isa_report_draft_objects
  ADD CONSTRAINT isa_report_exec_summary_source_coherent
    CHECK ((exec_summary IS NULL) = (exec_summary_source IS NULL)),
  ADD CONSTRAINT isa_report_auditee_background_source_coherent
    CHECK ((auditee_background IS NULL) = (auditee_background_source IS NULL)),
  ADD CONSTRAINT isa_report_opening_meeting_source_coherent
    CHECK ((opening_meeting IS NULL) = (opening_meeting_source IS NULL)),
  ADD CONSTRAINT isa_report_closing_meeting_source_coherent
    CHECK ((closing_meeting IS NULL) = (closing_meeting_source IS NULL));


-- -----------------------------------------------------------------------------
-- audit_mode_upsert_isa_report_draft — replacement adding p_*_source params.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS audit_mode_upsert_isa_report_draft(
  uuid, text, boolean, text, boolean, text, boolean, text, boolean,
  isa_site_verdict, boolean, text, boolean, integer, text, text
);

CREATE FUNCTION audit_mode_upsert_isa_report_draft(
  p_audit_id                    uuid,
  p_exec_summary                text             DEFAULT NULL,
  p_clear_exec_summary          boolean          DEFAULT FALSE,
  p_exec_summary_source         text             DEFAULT NULL,
  p_auditee_background          text             DEFAULT NULL,
  p_clear_auditee_background    boolean          DEFAULT FALSE,
  p_auditee_background_source   text             DEFAULT NULL,
  p_opening_meeting             text             DEFAULT NULL,
  p_clear_opening_meeting       boolean          DEFAULT FALSE,
  p_opening_meeting_source      text             DEFAULT NULL,
  p_closing_meeting             text             DEFAULT NULL,
  p_clear_closing_meeting       boolean          DEFAULT FALSE,
  p_closing_meeting_source      text             DEFAULT NULL,
  p_site_verdict                isa_site_verdict DEFAULT NULL,
  p_clear_site_verdict          boolean          DEFAULT FALSE,
  p_site_verdict_text           text             DEFAULT NULL,
  p_clear_site_verdict_text     boolean          DEFAULT FALSE,
  p_response_due_days           integer          DEFAULT NULL,
  p_response_due_basis          text             DEFAULT NULL,
  p_reason                      text             DEFAULT NULL
)
RETURNS isa_report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_workflow audit_workflow_type;
  v_before   isa_report_draft_objects;
  v_after    isa_report_draft_objects;
  v_delta    jsonb := '{}'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT workflow_type INTO v_workflow FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;
  IF v_workflow <> 'INVESTIGATOR_SITE_AUDIT' THEN
    RAISE EXCEPTION 'ISA report drafts are only available on investigator site audits'
      USING ERRCODE = '23514';
  END IF;

  IF p_response_due_basis IS NOT NULL
     AND p_response_due_basis NOT IN ('CALENDAR', 'BUSINESS') THEN
    RAISE EXCEPTION 'response_due_basis must be CALENDAR or BUSINESS' USING ERRCODE = '23514';
  END IF;
  IF p_exec_summary_source       IS NOT NULL AND p_exec_summary_source       NOT IN ('llm', 'auditor_edited')
  OR p_auditee_background_source IS NOT NULL AND p_auditee_background_source NOT IN ('llm', 'auditor_edited')
  OR p_opening_meeting_source    IS NOT NULL AND p_opening_meeting_source    NOT IN ('llm', 'auditor_edited')
  OR p_closing_meeting_source    IS NOT NULL AND p_closing_meeting_source    NOT IN ('llm', 'auditor_edited') THEN
    RAISE EXCEPTION 'section source must be llm or auditor_edited' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_before FROM isa_report_draft_objects WHERE audit_id = p_audit_id;
  IF NOT FOUND THEN
    INSERT INTO isa_report_draft_objects (audit_id, created_by)
    VALUES (p_audit_id, v_user)
    RETURNING * INTO v_before;
  END IF;

  UPDATE isa_report_draft_objects
     SET exec_summary       = CASE WHEN p_clear_exec_summary THEN NULL
                                   ELSE COALESCE(NULLIF(btrim(COALESCE(p_exec_summary, '')), ''), exec_summary) END,
         exec_summary_source
           = CASE WHEN p_clear_exec_summary THEN NULL
                  WHEN NULLIF(btrim(COALESCE(p_exec_summary, '')), '') IS NOT NULL
                    THEN COALESCE(p_exec_summary_source, 'auditor_edited')
                  ELSE exec_summary_source END,
         auditee_background = CASE WHEN p_clear_auditee_background THEN NULL
                                   ELSE COALESCE(NULLIF(btrim(COALESCE(p_auditee_background, '')), ''), auditee_background) END,
         auditee_background_source
           = CASE WHEN p_clear_auditee_background THEN NULL
                  WHEN NULLIF(btrim(COALESCE(p_auditee_background, '')), '') IS NOT NULL
                    THEN COALESCE(p_auditee_background_source, 'auditor_edited')
                  ELSE auditee_background_source END,
         opening_meeting    = CASE WHEN p_clear_opening_meeting THEN NULL
                                   ELSE COALESCE(NULLIF(btrim(COALESCE(p_opening_meeting, '')), ''), opening_meeting) END,
         opening_meeting_source
           = CASE WHEN p_clear_opening_meeting THEN NULL
                  WHEN NULLIF(btrim(COALESCE(p_opening_meeting, '')), '') IS NOT NULL
                    THEN COALESCE(p_opening_meeting_source, 'auditor_edited')
                  ELSE opening_meeting_source END,
         closing_meeting    = CASE WHEN p_clear_closing_meeting THEN NULL
                                   ELSE COALESCE(NULLIF(btrim(COALESCE(p_closing_meeting, '')), ''), closing_meeting) END,
         closing_meeting_source
           = CASE WHEN p_clear_closing_meeting THEN NULL
                  WHEN NULLIF(btrim(COALESCE(p_closing_meeting, '')), '') IS NOT NULL
                    THEN COALESCE(p_closing_meeting_source, 'auditor_edited')
                  ELSE closing_meeting_source END,
         site_verdict       = CASE WHEN p_clear_site_verdict THEN NULL
                                   ELSE COALESCE(p_site_verdict, site_verdict) END,
         site_verdict_text  = CASE WHEN p_clear_site_verdict_text THEN NULL
                                   ELSE COALESCE(NULLIF(btrim(COALESCE(p_site_verdict_text, '')), ''), site_verdict_text) END,
         response_due_days  = COALESCE(p_response_due_days, response_due_days),
         response_due_basis = COALESCE(p_response_due_basis, response_due_basis)
   WHERE audit_id = p_audit_id
  RETURNING * INTO v_after;

  IF v_before.exec_summary IS DISTINCT FROM v_after.exec_summary THEN
    v_delta := v_delta || jsonb_build_object('exec_summary',
      jsonb_build_object('from', v_before.exec_summary, 'to', v_after.exec_summary));
  END IF;
  IF v_before.exec_summary_source IS DISTINCT FROM v_after.exec_summary_source THEN
    v_delta := v_delta || jsonb_build_object('exec_summary_source',
      jsonb_build_object('from', v_before.exec_summary_source, 'to', v_after.exec_summary_source));
  END IF;
  IF v_before.auditee_background IS DISTINCT FROM v_after.auditee_background THEN
    v_delta := v_delta || jsonb_build_object('auditee_background',
      jsonb_build_object('from', v_before.auditee_background, 'to', v_after.auditee_background));
  END IF;
  IF v_before.auditee_background_source IS DISTINCT FROM v_after.auditee_background_source THEN
    v_delta := v_delta || jsonb_build_object('auditee_background_source',
      jsonb_build_object('from', v_before.auditee_background_source, 'to', v_after.auditee_background_source));
  END IF;
  IF v_before.opening_meeting IS DISTINCT FROM v_after.opening_meeting THEN
    v_delta := v_delta || jsonb_build_object('opening_meeting',
      jsonb_build_object('from', v_before.opening_meeting, 'to', v_after.opening_meeting));
  END IF;
  IF v_before.opening_meeting_source IS DISTINCT FROM v_after.opening_meeting_source THEN
    v_delta := v_delta || jsonb_build_object('opening_meeting_source',
      jsonb_build_object('from', v_before.opening_meeting_source, 'to', v_after.opening_meeting_source));
  END IF;
  IF v_before.closing_meeting IS DISTINCT FROM v_after.closing_meeting THEN
    v_delta := v_delta || jsonb_build_object('closing_meeting',
      jsonb_build_object('from', v_before.closing_meeting, 'to', v_after.closing_meeting));
  END IF;
  IF v_before.closing_meeting_source IS DISTINCT FROM v_after.closing_meeting_source THEN
    v_delta := v_delta || jsonb_build_object('closing_meeting_source',
      jsonb_build_object('from', v_before.closing_meeting_source, 'to', v_after.closing_meeting_source));
  END IF;
  IF v_before.site_verdict IS DISTINCT FROM v_after.site_verdict THEN
    v_delta := v_delta || jsonb_build_object('site_verdict',
      jsonb_build_object('from', v_before.site_verdict, 'to', v_after.site_verdict));
  END IF;
  IF v_before.site_verdict_text IS DISTINCT FROM v_after.site_verdict_text THEN
    v_delta := v_delta || jsonb_build_object('site_verdict_text',
      jsonb_build_object('from', v_before.site_verdict_text, 'to', v_after.site_verdict_text));
  END IF;
  IF v_before.response_due_days IS DISTINCT FROM v_after.response_due_days THEN
    v_delta := v_delta || jsonb_build_object('response_due_days',
      jsonb_build_object('from', v_before.response_due_days, 'to', v_after.response_due_days));
  END IF;
  IF v_before.response_due_basis IS DISTINCT FROM v_after.response_due_basis THEN
    v_delta := v_delta || jsonb_build_object('response_due_basis',
      jsonb_build_object('from', v_before.response_due_basis, 'to', v_after.response_due_basis));
  END IF;

  IF v_delta <> '{}'::jsonb THEN
    PERFORM audit_mode_write_delta(
      'ISA_REPORT_DRAFT_OBJECT'::tracked_object_type,
      v_after.id,
      v_delta,
      v_user,
      COALESCE(p_reason, 'Report draft updated')
    );
  END IF;

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_upsert_isa_report_draft(
  uuid, text, boolean, text, text, boolean, text, text, boolean, text,
  text, boolean, text, isa_site_verdict, boolean, text, boolean,
  integer, text, text
) TO authenticated;
