-- =============================================================================
-- Audit Mode — candidate observations: entry origin + promote RPC
-- (fieldwork lane, slice 2)
--
-- PIQC drafts CANDIDATE observations from the vendor-audit notes pad and the
-- filed evidence (edge function audit-observation-draft — proposals only, it
-- writes nothing). The auditor accepts, edits, or rejects each one. Accepting
-- is the only path from candidate to record, and it goes through
-- audit_mode_promote_workspace_candidate below: one transaction that inserts
-- the Stage-6 entry WITH provenance, stamps the consumed notes, and writes one
-- delta carrying the full evidence chain.
--
-- Additive only (backend partner away): the applied entry RPCs
-- (20260430180000) are untouched — hand-typed entries keep flowing through
-- audit_mode_create_workspace_entry and default to origin AUDITOR. The
-- promote RPC is a direct-INSERT sibling (ISA's create-with-origin precedent,
-- 20260727000000) rather than a wrapper: wrapping the applied create RPC
-- would force a post-hoc UPDATE and a second, contradictory delta.
--
-- What a candidate can and cannot carry (D4 doctrine — the model never
-- authors observations of record, and never grades them): the promote RPC
-- takes classification and impact ONLY as auditor-set parameters with the
-- same defaults as the create RPC (NOT_YET_CLASSIFIED blocks Stage-8 sign-off
-- and is excluded from report bodies, so bulk acceptance is safe by
-- construction). The edge function's response shape has no severity or
-- classification field at all.
--
-- Provenance: origin (PIQC_DRAFTED = accepted verbatim, PIQC_EDITED = edited
-- before acceptance) + source_note_ids (derived server-side from the
-- evidence chain — the client cannot send an inconsistent pair). The gated
-- evidence items and the verified protocol quote ride in the delta only:
-- entries have no evidence/protocol_refs columns, and adding them for the
-- trail alone is a partner-return conversation (ledgered).
--
-- Lane-specific enum on purpose: the ISA lane flips DRAFTED→EDITED on any
-- later content edit; the vendor lane defers that flip (origin param on the
-- applied update RPC — partner's return). Sharing isa_finding_origin would
-- couple two provenance vocabularies that already differ.
-- =============================================================================

CREATE TYPE workspace_entry_origin AS ENUM ('AUDITOR', 'PIQC_DRAFTED', 'PIQC_EDITED');

ALTER TABLE audit_workspace_entry_objects
  ADD COLUMN origin          workspace_entry_origin NOT NULL DEFAULT 'AUDITOR',
  ADD COLUMN source_note_ids uuid[]                 NOT NULL DEFAULT '{}'::uuid[];


-- -----------------------------------------------------------------------------
-- audit_mode_validate_candidate_evidence — the entry-lane twin of
-- audit_mode_validate_isa_evidence (20260724000100).
--
-- Shape: [{ text, source_note_ids: [uuid…], source_passages?: [{ chunk_id,
-- document_id, … }] }]. Every item must cite ≥1 note OR ≥1 evidence passage
-- (evidence-only candidates are legitimate — the owner scoped grounding as
-- notes + filed evidence). Every cited note must be live, on THIS audit, and
-- un-promoted in BOTH lanes — the friendly error the single-promotion CHECK
-- (20260908000000) must never be the only source of.
--
-- Locks the cited notes FOR UPDATE for the rest of the caller's transaction:
-- two accepts citing the same note in parallel serialize here, and the
-- second re-reads the first's backlink and raises instead of overwriting it.
-- Returns the distinct cited note ids.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_validate_candidate_evidence(
  p_audit_id uuid,
  p_evidence jsonb
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item     jsonb;
  v_passages jsonb;
  v_passage  jsonb;
  v_uuid     uuid;
  v_note_ids uuid[];
  v_live     int;
  v_promoted int;
BEGIN
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'array' THEN
    RAISE EXCEPTION 'evidence must be a JSON array' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(p_evidence) = 0 THEN
    RAISE EXCEPTION 'a candidate needs at least one evidence item' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(p_evidence) > 12 THEN
    RAISE EXCEPTION 'evidence is capped at 12 items' USING ERRCODE = '23514';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_evidence) LOOP
    IF jsonb_typeof(v_item->'text') <> 'string'
       OR length(btrim(v_item->>'text')) = 0
       OR length(v_item->>'text') > 2000 THEN
      RAISE EXCEPTION 'each evidence item needs non-empty text of at most 2,000 characters'
        USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(v_item->'source_note_ids') <> 'array' THEN
      RAISE EXCEPTION 'each evidence item needs a source_note_ids array' USING ERRCODE = '23514';
    END IF;
    IF v_item ? 'source_passages' AND jsonb_typeof(v_item->'source_passages') NOT IN ('null', 'array') THEN
      RAISE EXCEPTION 'source_passages must be an array' USING ERRCODE = '23514';
    END IF;
    -- Absent or JSON-null passages read as an empty array (jsonb_array_length
    -- raises on a JSON null; the shape check above only admits null/array).
    v_passages := CASE WHEN jsonb_typeof(v_item->'source_passages') = 'array'
                       THEN v_item->'source_passages' ELSE '[]'::jsonb END;
    IF jsonb_array_length(v_item->'source_note_ids') = 0
       AND jsonb_array_length(v_passages) = 0 THEN
      RAISE EXCEPTION 'each evidence item must cite a fieldwork note or an evidence passage'
        USING ERRCODE = '23514';
    END IF;
    -- Passage breadcrumbs: present and well-formed uuids (shape only — the
    -- edge function materialized them from rows it actually retrieved).
    FOR v_passage IN SELECT * FROM jsonb_array_elements(v_passages) LOOP
      IF jsonb_typeof(v_passage) <> 'object' THEN
        RAISE EXCEPTION 'each source passage must be an object' USING ERRCODE = '23514';
      END IF;
      BEGIN
        v_uuid := (v_passage->>'chunk_id')::uuid;
        IF v_uuid IS NULL THEN
          RAISE EXCEPTION 'source passage chunk_id is required' USING ERRCODE = '23514';
        END IF;
        v_uuid := (v_passage->>'document_id')::uuid;
        IF v_uuid IS NULL THEN
          RAISE EXCEPTION 'source passage document_id is required' USING ERRCODE = '23514';
        END IF;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'source passage chunk_id and document_id must be uuids' USING ERRCODE = '23514';
      END;
    END LOOP;
  END LOOP;

  BEGIN
    SELECT COALESCE(array_agg(DISTINCT nid::uuid), '{}'::uuid[])
      INTO v_note_ids
      FROM jsonb_array_elements(p_evidence) AS item,
           jsonb_array_elements_text(item->'source_note_ids') AS nid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'source_note_ids must be uuids' USING ERRCODE = '23514';
  END;

  IF array_length(v_note_ids, 1) IS NOT NULL THEN
    -- Lock first (an aggregate cannot carry FOR UPDATE), then read the
    -- post-lock state — READ COMMITTED gives the second of two racing
    -- accepts the first's committed backlink.
    PERFORM 1 FROM audit_note_objects WHERE id = ANY(v_note_ids) FOR UPDATE;

    SELECT count(*),
           count(*) FILTER (WHERE n.promoted_entry_id IS NOT NULL OR n.promoted_finding_id IS NOT NULL)
      INTO v_live, v_promoted
      FROM audit_note_objects n
     WHERE n.id = ANY(v_note_ids)
       AND n.audit_id = p_audit_id
       AND n.deleted_at IS NULL;

    IF v_live <> array_length(v_note_ids, 1) THEN
      RAISE EXCEPTION 'candidate cites a note that is missing or deleted — re-run drafting'
        USING ERRCODE = '23514';
    END IF;
    IF v_promoted > 0 THEN
      RAISE EXCEPTION 'candidate cites a note already promoted into an accepted observation — re-run drafting'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN v_note_ids;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_promote_workspace_candidate — accept one candidate.
--
-- Origin must be PIQC_DRAFTED or PIQC_EDITED: hand-typed entries take the
-- applied create RPC. The verified protocol quote (optional) is shape-checked
-- by the applied ISA validator — it is shape-only and lane-agnostic — and is
-- recorded in the delta, not on the row.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_promote_workspace_candidate(
  p_audit_id                   uuid,
  p_vendor_domain              text,
  p_observation_text           text,
  p_origin                     workspace_entry_origin,
  p_evidence                   jsonb,
  p_checkpoint_ref             text                       DEFAULT NULL,
  p_protocol_ref               jsonb                      DEFAULT NULL,
  p_provisional_impact         provisional_impact         DEFAULT 'NONE',
  p_provisional_classification provisional_classification DEFAULT 'NOT_YET_CLASSIFIED',
  p_reason                     text                       DEFAULT NULL
)
RETURNS audit_workspace_entry_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_workflow audit_workflow_type;
  v_note_ids uuid[];
  v_after    audit_workspace_entry_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_origin IS NULL OR p_origin = 'AUDITOR' THEN
    RAISE EXCEPTION 'promote is for PIQC-drafted candidates; auditor entries use audit_mode_create_workspace_entry'
      USING ERRCODE = '23514';
  END IF;
  -- NULL-safe: PostgREST passes explicit nulls; without the IS NULL arm the
  -- check is NULL (not fired) and the INSERT raises a raw 23502.
  IF p_vendor_domain IS NULL OR length(btrim(p_vendor_domain)) = 0 THEN
    RAISE EXCEPTION 'vendor_domain must not be empty' USING ERRCODE = '23514';
  END IF;
  IF p_observation_text IS NULL OR length(btrim(p_observation_text)) = 0 THEN
    RAISE EXCEPTION 'observation_text must not be empty' USING ERRCODE = '23514';
  END IF;

  -- RLS hides other auditors' audits, so NOT FOUND covers missing and
  -- inaccessible ids alike.
  SELECT workflow_type INTO v_workflow FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;
  IF v_workflow <> 'VENDOR_AUDIT' THEN
    RAISE EXCEPTION 'Candidate observations are only available on vendor audits'
      USING ERRCODE = '23514';
  END IF;

  v_note_ids := audit_mode_validate_candidate_evidence(p_audit_id, p_evidence);

  IF p_protocol_ref IS NOT NULL THEN
    IF jsonb_typeof(p_protocol_ref) <> 'object' THEN
      RAISE EXCEPTION 'protocol_ref must be a JSON object' USING ERRCODE = '23514';
    END IF;
    PERFORM audit_mode_validate_isa_protocol_refs(jsonb_build_array(p_protocol_ref));
  END IF;

  INSERT INTO audit_workspace_entry_objects (
    audit_id,
    checkpoint_ref,
    vendor_domain,
    observation_text,
    provisional_impact,
    provisional_classification,
    origin,
    source_note_ids,
    created_by
  ) VALUES (
    p_audit_id,
    NULLIF(btrim(COALESCE(p_checkpoint_ref, '')), ''),
    btrim(p_vendor_domain),
    btrim(p_observation_text),
    p_provisional_impact,
    p_provisional_classification,
    p_origin,
    v_note_ids,
    v_user
  )
  RETURNING * INTO v_after;

  -- Consume the cited notes — atomic with the insert. They are locked and
  -- verified un-promoted by the validator above.
  IF array_length(v_note_ids, 1) IS NOT NULL THEN
    UPDATE audit_note_objects
       SET promoted_entry_id = v_after.id
     WHERE id = ANY(v_note_ids);
  END IF;

  PERFORM audit_mode_write_delta(
    'AUDIT_WORKSPACE_ENTRY_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'vendor_domain',              jsonb_build_object('from', NULL, 'to', v_after.vendor_domain),
      'observation_text',           jsonb_build_object('from', NULL, 'to', v_after.observation_text),
      'provisional_impact',         jsonb_build_object('from', NULL, 'to', v_after.provisional_impact),
      'provisional_classification', jsonb_build_object('from', NULL, 'to', v_after.provisional_classification),
      'checkpoint_ref',             jsonb_build_object('from', NULL, 'to', v_after.checkpoint_ref),
      'origin',                     jsonb_build_object('from', NULL, 'to', v_after.origin),
      'source_note_ids',            jsonb_build_object('from', NULL, 'to', to_jsonb(v_after.source_note_ids)),
      'evidence_refs',              jsonb_build_object('from', NULL, 'to', p_evidence),
      'protocol_ref',               jsonb_build_object('from', NULL, 'to', p_protocol_ref)
    ),
    v_user,
    COALESCE(p_reason, 'Candidate observation accepted')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants — anon revoked per the 20260727000000 precedent.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION audit_mode_validate_candidate_evidence(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION audit_mode_promote_workspace_candidate(
  uuid, text, text, workspace_entry_origin, jsonb, text, jsonb, provisional_impact, provisional_classification, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION audit_mode_validate_candidate_evidence(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_promote_workspace_candidate(
  uuid, text, text, workspace_entry_origin, jsonb, text, jsonb, provisional_impact, provisional_classification, text
) TO authenticated;
