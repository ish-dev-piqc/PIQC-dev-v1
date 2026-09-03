-- =============================================================================
-- Audit Mode — candidate observations: entry provenance + promote RPC
-- (fieldwork lane, slice 2)
--
-- PIQC drafts CANDIDATE observations from the vendor-audit notes pad and the
-- filed evidence (edge function audit-observation-draft — proposals only, it
-- writes nothing). The auditor accepts, edits, or rejects each one. Accepting
-- is the only path from candidate to record, and it goes through
-- audit_mode_promote_workspace_candidate below: one transaction that inserts
-- the Stage-6 entry WITH provenance, stamps the consumed notes, and writes one
-- delta.
--
-- Additive only (backend partner away): the applied entry RPCs
-- (20260430180000) are untouched — hand-typed entries keep flowing through
-- audit_mode_create_workspace_entry and default to origin AUDITOR. The
-- promote RPC is a direct-INSERT sibling (ISA's create-with-origin precedent,
-- 20260727000000) rather than a wrapper: wrapping the applied create RPC
-- would force a post-hoc UPDATE and a second, contradictory delta.
--
-- Provenance is RECORD content, not change history (the ISA lane's
-- isa_finding_objects stores evidence and protocol_refs as columns; nothing
-- downstream reads deltas):
--   origin           PIQC_DRAFTED (accepted verbatim) / PIQC_EDITED — decided
--                    SERVER-SIDE by comparing the accepted text with the
--                    engine's proposal (p_drafted), never by a client flag
--   source_note_ids  the fieldwork notes consumed (derived from the evidence
--                    chain — the client cannot send an inconsistent pair)
--   evidence_refs    the gated evidence chain: note ids + filed-document
--                    passages (chunk / document ids, content_hash = document
--                    version, section, pages)
--   protocol_ref     the verified verbatim protocol quote, if any
--   drafting_engine  { function, model } that proposed it (Law 5: model/tool)
--   candidate_key    the client-minted key of the candidate — UNIQUE per
--                    audit, so a lost response + second click, a double
--                    click, or a second tab cannot record the same candidate
--                    twice. Note locks only protect note-citing candidates;
--                    evidence-only candidates need this key.
--
-- What a candidate can and cannot carry (D4 doctrine — the model never
-- authors observations of record, and never grades them): classification is
-- an auditor-set parameter with the create RPC's default (NOT_YET_CLASSIFIED
-- blocks Stage-8 sign-off and is excluded from report bodies, so bulk
-- acceptance is safe by construction); impact stays at its default until the
-- auditor edits the entry. The engine's response shape has no severity,
-- impact, or classification field at all.
--
-- Lane-specific enum on purpose: the ISA lane flips DRAFTED→EDITED on any
-- later content edit; the vendor lane defers that flip (origin param on the
-- applied update RPC — partner's return). Sharing isa_finding_origin would
-- couple two provenance vocabularies that already differ.
-- =============================================================================

CREATE TYPE workspace_entry_origin AS ENUM ('AUDITOR', 'PIQC_DRAFTED', 'PIQC_EDITED');

ALTER TABLE audit_workspace_entry_objects
  ADD COLUMN origin          workspace_entry_origin NOT NULL DEFAULT 'AUDITOR',
  ADD COLUMN source_note_ids uuid[]                 NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN evidence_refs   jsonb                  NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT audit_workspace_entry_evidence_refs_is_array CHECK (jsonb_typeof(evidence_refs) = 'array'),
  ADD COLUMN protocol_ref    jsonb,
  ADD COLUMN drafting_engine jsonb,
  ADD COLUMN candidate_key   text;

-- One record per accepted candidate per audit; hand-typed entries carry NULL.
CREATE UNIQUE INDEX audit_workspace_entry_candidate_key_uniq
  ON audit_workspace_entry_objects (audit_id, candidate_key)
  WHERE candidate_key IS NOT NULL;


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
-- Key-presence checks use IS DISTINCT FROM: `jsonb_typeof(NULL) <> 'array'`
-- is NULL, not TRUE, so a `<>` guard silently admits an item with the key
-- missing.
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
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'each evidence item must be an object' USING ERRCODE = '23514';
    END IF;
    -- 1,000 = the drafting gates' cap (gates.ts MAX_EVIDENCE_TEXT_CHARS).
    IF jsonb_typeof(v_item->'text') IS DISTINCT FROM 'string'
       OR length(btrim(v_item->>'text')) = 0
       OR length(v_item->>'text') > 1000 THEN
      RAISE EXCEPTION 'each evidence item needs non-empty text of at most 1,000 characters'
        USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(v_item->'source_note_ids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'each evidence item needs a source_note_ids array' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(v_item->'source_passages') NOT IN ('null', 'array') THEN
      RAISE EXCEPTION 'source_passages must be an array' USING ERRCODE = '23514';
    END IF;
    -- Absent or JSON-null passages read as an empty array (jsonb_array_length
    -- raises on a JSON null).
    v_passages := CASE WHEN jsonb_typeof(v_item->'source_passages') = 'array'
                       THEN v_item->'source_passages' ELSE '[]'::jsonb END;
    IF jsonb_array_length(v_item->'source_note_ids') = 0
       AND jsonb_array_length(v_passages) = 0 THEN
      RAISE EXCEPTION 'each evidence item must cite a fieldwork note or an evidence passage'
        USING ERRCODE = '23514';
    END IF;
    -- Passage breadcrumbs go on the record (evidence_refs): present and
    -- well-formed uuids. Shape only — the edge function materialized them
    -- from rows it actually retrieved.
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
    -- Lock and read in one pass: the locked set is exactly the live,
    -- same-audit rows the RPC is about to consume (an aggregate cannot carry
    -- FOR UPDATE at its own level, hence the sub-select). READ COMMITTED
    -- gives the second of two racing accepts the first's committed backlink.
    SELECT count(*),
           count(*) FILTER (WHERE locked.promoted_entry_id IS NOT NULL
                               OR locked.promoted_finding_id IS NOT NULL)
      INTO v_live, v_promoted
      FROM (
        SELECT n.promoted_entry_id, n.promoted_finding_id
          FROM audit_note_objects n
         WHERE n.id = ANY(v_note_ids)
           AND n.audit_id = p_audit_id
           AND n.deleted_at IS NULL
           FOR UPDATE
      ) AS locked;

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
-- p_drafted is the engine's proposal as returned ({ vendor_domain,
-- observation_text, checkpoint_ref }); origin is PIQC_DRAFTED when the
-- accepted text matches it after trimming, PIQC_EDITED otherwise. The
-- verified protocol quote (optional) is shape-checked by the applied ISA
-- validator — it is shape-only and lane-agnostic. A repeat of the same
-- candidate_key on the same audit raises 23505 with a friendly message.
--
-- Open hole, ledgered: the server cannot prove p_drafted is what the engine
-- proposed (a client could fabricate both). Closing it takes an HMAC
-- attestation minted by the edge function and checked here — partner-return
-- item, since it needs a shared secret in the database.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_promote_workspace_candidate(
  p_audit_id                   uuid,
  p_candidate_key              text,
  p_vendor_domain              text,
  p_observation_text           text,
  p_evidence                   jsonb,
  p_drafted                    jsonb,
  p_engine                     jsonb,
  p_checkpoint_ref             text                       DEFAULT NULL,
  p_protocol_ref               jsonb                      DEFAULT NULL,
  p_provisional_classification provisional_classification DEFAULT 'NOT_YET_CLASSIFIED',
  p_reason                     text                       DEFAULT NULL
)
RETURNS audit_workspace_entry_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user       uuid := auth.uid();
  v_workflow   audit_workflow_type;
  v_note_ids   uuid[];
  v_origin     workspace_entry_origin;
  v_checkpoint text;
  v_after      audit_workspace_entry_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  -- NULL-safe: PostgREST passes explicit nulls; without the IS NULL arm the
  -- check is NULL (not fired) and the INSERT raises a raw 23502.
  IF p_candidate_key IS NULL OR length(btrim(p_candidate_key)) = 0 OR length(p_candidate_key) > 64 THEN
    RAISE EXCEPTION 'candidate_key must be 1–64 characters' USING ERRCODE = '23514';
  END IF;
  IF p_vendor_domain IS NULL OR length(btrim(p_vendor_domain)) = 0 THEN
    RAISE EXCEPTION 'vendor_domain must not be empty' USING ERRCODE = '23514';
  END IF;
  IF p_observation_text IS NULL OR length(btrim(p_observation_text)) = 0 THEN
    RAISE EXCEPTION 'observation_text must not be empty' USING ERRCODE = '23514';
  END IF;
  IF p_drafted IS NULL OR jsonb_typeof(p_drafted) <> 'object'
     OR jsonb_typeof(p_drafted->'vendor_domain') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_drafted->'observation_text') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_drafted->'checkpoint_ref') NOT IN ('null', 'string') THEN
    RAISE EXCEPTION 'drafted must carry the proposed vendor_domain, observation_text, and checkpoint_ref'
      USING ERRCODE = '23514';
  END IF;
  IF p_engine IS NULL OR jsonb_typeof(p_engine) <> 'object'
     OR jsonb_typeof(p_engine->'function') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_engine->'model') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'engine must name the drafting function and model' USING ERRCODE = '23514';
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

  -- Origin is a comparison, not a claim.
  v_checkpoint := NULLIF(btrim(COALESCE(p_checkpoint_ref, '')), '');
  v_origin := CASE
    WHEN btrim(p_vendor_domain)    = btrim(p_drafted->>'vendor_domain')
     AND btrim(p_observation_text) = btrim(p_drafted->>'observation_text')
     AND v_checkpoint IS NOT DISTINCT FROM NULLIF(btrim(COALESCE(p_drafted->>'checkpoint_ref', '')), '')
    THEN 'PIQC_DRAFTED'::workspace_entry_origin
    ELSE 'PIQC_EDITED'::workspace_entry_origin
  END;

  BEGIN
    INSERT INTO audit_workspace_entry_objects (
      audit_id,
      checkpoint_ref,
      vendor_domain,
      observation_text,
      provisional_classification,
      origin,
      source_note_ids,
      evidence_refs,
      protocol_ref,
      drafting_engine,
      candidate_key,
      created_by
    ) VALUES (
      p_audit_id,
      v_checkpoint,
      btrim(p_vendor_domain),
      btrim(p_observation_text),
      p_provisional_classification,
      v_origin,
      v_note_ids,
      p_evidence,
      p_protocol_ref,
      p_engine,
      btrim(p_candidate_key),
      v_user
    )
    RETURNING * INTO v_after;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This candidate was already accepted — it is in the observation record'
      USING ERRCODE = '23505';
  END;

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
      'evidence_refs',              jsonb_build_object('from', NULL, 'to', v_after.evidence_refs),
      'protocol_ref',               jsonb_build_object('from', NULL, 'to', v_after.protocol_ref),
      'drafting_engine',            jsonb_build_object('from', NULL, 'to', v_after.drafting_engine),
      'candidate_key',              jsonb_build_object('from', NULL, 'to', v_after.candidate_key),
      -- The proposal as the engine returned it — what the auditor changed
      -- (or did not) is reconstructable from this alone.
      'drafted',                    jsonb_build_object('from', NULL, 'to', p_drafted)
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
  uuid, text, text, text, jsonb, jsonb, jsonb, text, jsonb, provisional_classification, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION audit_mode_validate_candidate_evidence(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_promote_workspace_candidate(
  uuid, text, text, text, jsonb, jsonb, jsonb, text, jsonb, provisional_classification, text
) TO authenticated;
