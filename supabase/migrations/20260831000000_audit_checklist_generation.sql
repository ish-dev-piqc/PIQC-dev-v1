-- =============================================================================
-- Audit Mode — grounded checklist generation (PR-C1)
--
-- The audit checklist gains grounded AI generation over protocol chunks + the
-- PR-B evidence register (audit_source_documents WHERE include_in_generation).
-- The /audit-checklist-draft edge function returns a PROPOSAL (it never
-- writes); the client applies it via audit_mode_apply_checklist_generation,
-- which wraps the EXISTING upsert — demote-on-edit latch and delta trail are
-- reused, never duplicated — then stamps three generation columns:
--
--   generation_refs     — retrieval breadcrumbs that survived the verbatim-
--                         quote gate: [{item_id, chunk_id, document_id,
--                         source: 'PROTOCOL'|'EVIDENCE', quote, doc_title,
--                         section_heading, page_start, page_end}]. Snapshot
--                         semantics (isa protocol_refs precedent): rows may
--                         outlive the chunks/documents they name.
--   grounding_snapshot  — what the generation actually saw: {protocol_document_ids,
--                         evidence: [{document_id, content_hash, title,
--                         source_type}]}. The client's currency notice is a
--                         set-diff of this against the live register — a flag,
--                         never a block.
--   generated_at        — display + ordering for the currency copy.
--
-- Sibling precedent: prefilled_at / source_questionnaire_instance_id from the
-- templated Stage-5 prefill (20260515020000). The two provenance families
-- coexist: prefill = templated bootstrap, generation = grounded drafting.
-- =============================================================================

ALTER TABLE checklist_objects
  ADD COLUMN generation_refs    JSONB
    CONSTRAINT checklist_generation_refs_is_array
    CHECK (generation_refs IS NULL OR jsonb_typeof(generation_refs) = 'array'),
  ADD COLUMN grounding_snapshot JSONB
    CONSTRAINT checklist_grounding_snapshot_is_object
    CHECK (grounding_snapshot IS NULL OR jsonb_typeof(grounding_snapshot) = 'object'),
  ADD COLUMN generated_at       TIMESTAMPTZ;


-- -----------------------------------------------------------------------------
-- audit_mode_apply_checklist_generation
--
-- Applies a generated (or revised) checklist atomically: content goes through
-- audit_mode_upsert_checklist — inheriting its create/update deltas and the
-- content-changed → DRAFT demotion — then the generation stamp lands in the
-- same transaction, so a row can never show generated content without its
-- snapshot (or vice versa). The p_reason default carries the agentic
-- attribution into the history trail.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_apply_checklist_generation(
  p_audit_id           uuid,
  p_content            jsonb,
  p_generation_refs    jsonb,
  p_grounding_snapshot jsonb,
  p_reason             text DEFAULT NULL
)
RETURNS checklist_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_after checklist_objects;
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

  -- Content + latch + delta via the existing upsert (single transaction).
  v_after := audit_mode_upsert_checklist(
    p_audit_id,
    p_content,
    COALESCE(p_reason, 'Checklist drafted by PIQC from protocol + evidence')
  );

  UPDATE checklist_objects SET
    generation_refs    = p_generation_refs,
    grounding_snapshot = p_grounding_snapshot,
    generated_at       = NOW()
  WHERE id = v_after.id
  RETURNING * INTO v_after;

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_apply_checklist_generation(uuid, jsonb, jsonb, jsonb, text) TO authenticated;
