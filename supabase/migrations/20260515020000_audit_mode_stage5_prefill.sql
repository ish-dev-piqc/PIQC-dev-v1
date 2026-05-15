-- =============================================================================
-- Audit Mode — Stage 5 pre-fill from approved Stage 3 + Stage 4 context
--
-- Bootstraps Stage 5 deliverables (confirmation letter, agenda, checklist)
-- from the auditor's approved Stage 3 (questionnaire) and Stage 4 (risk
-- summary) state. Pre-fill is one-shot and snapshot-based: once the deliverable
-- row exists, edits are owned by the deliverable. Source amendments do not
-- clobber.
--
-- Why now:
--   The product feel is agentic — the auditor enters Stage 5 and the drafts
--   are already started. Provenance is preserved via FKs to the source rows
--   so the History drawer and any future review surface can answer
--   "where did this come from?"
--
-- Pre-conditions enforced server-side:
--   - Caller is the lead auditor on the target audit
--   - No existing deliverable row (don't clobber)
--   - Source rows in APPROVED state (risk summary OR questionnaire instance,
--     scoped to whichever the deliverable depends on)
--
-- ON DELETE SET NULL on source FKs: if a reviewer hard-deletes an upstream
-- row, the deliverable survives with the provenance link cleared. History
-- drawer still surfaces the original IDs from the initial-state delta.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Schema additions — additive, nullable
-- -----------------------------------------------------------------------------
ALTER TABLE confirmation_letter_objects
  ADD COLUMN source_risk_summary_id           UUID REFERENCES vendor_risk_summary_objects(id) ON DELETE SET NULL,
  ADD COLUMN source_questionnaire_instance_id UUID REFERENCES questionnaire_instances(id)      ON DELETE SET NULL,
  ADD COLUMN prefilled_at                     TIMESTAMPTZ;

ALTER TABLE agenda_objects
  ADD COLUMN source_risk_summary_id           UUID REFERENCES vendor_risk_summary_objects(id) ON DELETE SET NULL,
  ADD COLUMN prefilled_at                     TIMESTAMPTZ;

ALTER TABLE checklist_objects
  ADD COLUMN source_questionnaire_instance_id UUID REFERENCES questionnaire_instances(id)      ON DELETE SET NULL,
  ADD COLUMN prefilled_at                     TIMESTAMPTZ;


-- -----------------------------------------------------------------------------
-- Helper: is the caller the lead auditor on this audit?
--
-- Used by all three prefill RPCs. STABLE so it can be inlined.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_is_lead_auditor(p_audit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM audits
     WHERE id = p_audit_id
       AND lead_auditor_id = auth.uid()
  );
$$;


-- =============================================================================
-- PREFILL — Confirmation Letter
--
-- Sources:
--   risk_summary.focus_areas                    → content.scope[]
--   questionnaire_instance.vendor_contact_*     → content.recipients[]
--   audits.audit_name + scheduled_date + vendor → content.body_text (templated)
--
-- Pre-conditions:
--   - Caller is lead auditor on the audit
--   - No existing confirmation_letter_objects row
--   - Risk summary exists and approval_status = 'APPROVED'
--   - Questionnaire instance exists and approved_at IS NOT NULL
-- =============================================================================
CREATE OR REPLACE FUNCTION audit_mode_prefill_confirmation_letter(p_audit_id uuid)
RETURNS confirmation_letter_objects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user           uuid := auth.uid();
  v_audit          audits;
  v_risk_summary   vendor_risk_summary_objects;
  v_qn_instance    questionnaire_instances;
  v_vendor_name    text;
  v_scope          jsonb;
  v_recipients     jsonb;
  v_body_text      text;
  v_content        jsonb;
  v_after          confirmation_letter_objects;
  v_recipient_line text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT audit_mode_is_lead_auditor(p_audit_id) THEN
    RAISE EXCEPTION 'Not authorised to pre-fill deliverables for audit %', p_audit_id
      USING ERRCODE = '42501';
  END IF;

  -- Idempotent on absence: do nothing if the deliverable already exists.
  IF EXISTS (SELECT 1 FROM confirmation_letter_objects WHERE audit_id = p_audit_id) THEN
    RAISE EXCEPTION 'Confirmation letter already exists for audit %', p_audit_id
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_audit FROM audits WHERE id = p_audit_id;

  SELECT * INTO v_risk_summary FROM vendor_risk_summary_objects WHERE audit_id = p_audit_id;
  IF v_risk_summary.id IS NULL OR v_risk_summary.approval_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Risk summary must be APPROVED before pre-fill'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_qn_instance FROM questionnaire_instances WHERE audit_id = p_audit_id;
  IF v_qn_instance.id IS NULL OR v_qn_instance.approved_at IS NULL THEN
    RAISE EXCEPTION 'Questionnaire instance must be APPROVED before pre-fill'
      USING ERRCODE = '23514';
  END IF;

  -- focus_areas → scope (direct 1:1 string-array carry).
  v_scope := COALESCE(to_jsonb(v_risk_summary.focus_areas), '[]'::jsonb);

  -- vendor_contact_* → recipients. Format "Name (Title)" line then email line
  -- as separate entries so the existing array UI renders cleanly.
  v_recipients := '[]'::jsonb;
  IF v_qn_instance.vendor_contact_name IS NOT NULL THEN
    v_recipient_line := v_qn_instance.vendor_contact_name;
    IF v_qn_instance.vendor_contact_title IS NOT NULL THEN
      v_recipient_line := v_recipient_line || ' (' || v_qn_instance.vendor_contact_title || ')';
    END IF;
    v_recipients := v_recipients || to_jsonb(v_recipient_line);
  END IF;
  IF v_qn_instance.vendor_contact_email IS NOT NULL THEN
    v_recipients := v_recipients || to_jsonb(v_qn_instance.vendor_contact_email);
  END IF;

  -- body_text — a calm, vendor-facing scaffold. Audit-specific date inserted
  -- where available; falls back to "tentative date" wording when missing.
  SELECT v.name INTO v_vendor_name FROM vendors v WHERE v.id = v_audit.vendor_id;
  v_body_text :=
    'Thank you for your continued partnership on this study. This letter confirms the upcoming audit'
    || CASE WHEN v_vendor_name IS NOT NULL THEN ' of ' || v_vendor_name ELSE '' END || '.'
    || E'\n\n'
    || CASE
         WHEN v_audit.scheduled_date IS NOT NULL
           THEN 'Audit date: ' || to_char(v_audit.scheduled_date, 'DD Mon YYYY') || '.'
         ELSE 'Audit date is tentative and will be confirmed in a follow-up.'
       END
    || E'\n\n'
    || 'Audit scope is summarized below. Please confirm receipt and the proposed attendees from your side by reply.';

  v_content := jsonb_build_object(
    'body_text',  v_body_text,
    'recipients', v_recipients,
    'scope',      v_scope
  );

  INSERT INTO confirmation_letter_objects (
    audit_id, content, approval_status,
    source_risk_summary_id, source_questionnaire_instance_id, prefilled_at
  ) VALUES (
    p_audit_id, v_content, 'DRAFT',
    v_risk_summary.id, v_qn_instance.id, NOW()
  )
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'CONFIRMATION_LETTER_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'content',                          jsonb_build_object('from', NULL, 'to', v_after.content),
      'approval_status',                  jsonb_build_object('from', NULL, 'to', v_after.approval_status),
      'source_risk_summary_id',           jsonb_build_object('from', NULL, 'to', v_after.source_risk_summary_id),
      'source_questionnaire_instance_id', jsonb_build_object('from', NULL, 'to', v_after.source_questionnaire_instance_id),
      'prefilled_at',                     jsonb_build_object('from', NULL, 'to', v_after.prefilled_at)
    ),
    v_user,
    'Confirmation letter pre-filled from approved Stage 3 + Stage 4 context'
  );

  RETURN v_after;
END;
$$;


-- =============================================================================
-- PREFILL — Agenda
--
-- Sources:
--   risk_summary.focus_areas → content.items[].topic (1 item per focus area,
--                              blank time/owner/notes for the auditor to fill)
--
-- Pre-conditions:
--   - Caller is lead auditor on the audit
--   - No existing agenda_objects row
--   - Risk summary exists and approval_status = 'APPROVED'
-- =============================================================================
CREATE OR REPLACE FUNCTION audit_mode_prefill_agenda(p_audit_id uuid)
RETURNS agenda_objects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user         uuid := auth.uid();
  v_risk_summary vendor_risk_summary_objects;
  v_items        jsonb := '[]'::jsonb;
  v_content      jsonb;
  v_after        agenda_objects;
  v_focus        text;
  v_idx          int := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT audit_mode_is_lead_auditor(p_audit_id) THEN
    RAISE EXCEPTION 'Not authorised to pre-fill deliverables for audit %', p_audit_id
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM agenda_objects WHERE audit_id = p_audit_id) THEN
    RAISE EXCEPTION 'Agenda already exists for audit %', p_audit_id
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_risk_summary FROM vendor_risk_summary_objects WHERE audit_id = p_audit_id;
  IF v_risk_summary.id IS NULL OR v_risk_summary.approval_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Risk summary must be APPROVED before pre-fill'
      USING ERRCODE = '23514';
  END IF;

  -- One agenda item per focus area. Time/owner/notes blank — auditor fills.
  -- Stable IDs are scaffold-prefixed so the existing UI can key off them.
  FOREACH v_focus IN ARRAY v_risk_summary.focus_areas LOOP
    v_idx := v_idx + 1;
    v_items := v_items || jsonb_build_object(
      'id',    'agenda-pf-' || v_idx,
      'time',  '',
      'topic', v_focus,
      'owner', '',
      'notes', NULL
    );
  END LOOP;

  v_content := jsonb_build_object('items', v_items);

  INSERT INTO agenda_objects (
    audit_id, content, approval_status,
    source_risk_summary_id, prefilled_at
  ) VALUES (
    p_audit_id, v_content, 'DRAFT',
    v_risk_summary.id, NOW()
  )
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'AGENDA_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'content',                jsonb_build_object('from', NULL, 'to', v_after.content),
      'approval_status',        jsonb_build_object('from', NULL, 'to', v_after.approval_status),
      'source_risk_summary_id', jsonb_build_object('from', NULL, 'to', v_after.source_risk_summary_id),
      'prefilled_at',           jsonb_build_object('from', NULL, 'to', v_after.prefilled_at)
    ),
    v_user,
    'Agenda pre-filled from approved Stage 4 risk summary'
  );

  RETURN v_after;
END;
$$;


-- =============================================================================
-- PREFILL — Checklist
--
-- Sources:
--   questionnaire_responses (JOIN questionnaire_questions WHERE
--     answer_type='EVIDENCE_REQUEST' AND response_status='APPROVED')
--     → content.items[] with prompt = questionnaire prompt VERBATIM
--       and evidence_expected mirrored from the question
--
-- Phrasing transform ("Please provide X" → "Verify X") deferred to a future
-- LLM-assisted refinement. Verbatim carry preserves the agentic moment
-- without committing to a transform that may need product judgement.
--
-- Pre-conditions:
--   - Caller is lead auditor on the audit
--   - No existing checklist_objects row
--   - Questionnaire instance exists and approved_at IS NOT NULL
-- =============================================================================
CREATE OR REPLACE FUNCTION audit_mode_prefill_checklist(p_audit_id uuid)
RETURNS checklist_objects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_qn_instance questionnaire_instances;
  v_items       jsonb := '[]'::jsonb;
  v_content     jsonb;
  v_after       checklist_objects;
  v_row         record;
  v_idx         int := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT audit_mode_is_lead_auditor(p_audit_id) THEN
    RAISE EXCEPTION 'Not authorised to pre-fill deliverables for audit %', p_audit_id
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM checklist_objects WHERE audit_id = p_audit_id) THEN
    RAISE EXCEPTION 'Checklist already exists for audit %', p_audit_id
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_qn_instance FROM questionnaire_instances WHERE audit_id = p_audit_id;
  IF v_qn_instance.id IS NULL OR v_qn_instance.approved_at IS NULL THEN
    RAISE EXCEPTION 'Questionnaire instance must be APPROVED before pre-fill'
      USING ERRCODE = '23514';
  END IF;

  -- Evidence-request responses become checklist items. Verbatim prompt;
  -- auditor can rephrase post-fill. Ordering: by question.ordinal for
  -- predictable output across runs.
  FOR v_row IN
    SELECT q.prompt, q.evidence_expected, q.ordinal
      FROM questionnaire_response_objects r
      JOIN questionnaire_questions q ON q.id = r.question_id
     WHERE r.instance_id     = v_qn_instance.id
       AND q.answer_type     = 'EVIDENCE_REQUEST'
       AND r.response_status = 'APPROVED'
     ORDER BY q.ordinal ASC, q.id ASC
  LOOP
    v_idx := v_idx + 1;
    v_items := v_items || jsonb_build_object(
      'id',                'checklist-pf-' || v_idx,
      'prompt',            v_row.prompt,
      'checkpoint_ref',    NULL,
      'evidence_expected', v_row.evidence_expected
    );
  END LOOP;

  v_content := jsonb_build_object('items', v_items);

  INSERT INTO checklist_objects (
    audit_id, content, approval_status,
    source_questionnaire_instance_id, prefilled_at
  ) VALUES (
    p_audit_id, v_content, 'DRAFT',
    v_qn_instance.id, NOW()
  )
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'CHECKLIST_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'content',                          jsonb_build_object('from', NULL, 'to', v_after.content),
      'approval_status',                  jsonb_build_object('from', NULL, 'to', v_after.approval_status),
      'source_questionnaire_instance_id', jsonb_build_object('from', NULL, 'to', v_after.source_questionnaire_instance_id),
      'prefilled_at',                     jsonb_build_object('from', NULL, 'to', v_after.prefilled_at)
    ),
    v_user,
    'Checklist pre-filled from approved Stage 3 questionnaire'
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_is_lead_auditor(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_prefill_confirmation_letter(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_prefill_agenda(uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_prefill_checklist(uuid)               TO authenticated;
