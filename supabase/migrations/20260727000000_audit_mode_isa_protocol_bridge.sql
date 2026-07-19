-- =============================================================================
-- Audit Mode — ISA protocol-citation bridge (S4 of the notes → findings →
-- report arc)
--
-- A finding gains protocol_refs: citations of the site's OWN uploaded,
-- parsed protocol — the document quoted against the site's conduct — next to
-- the existing closed-world regulatory reference.
--
-- Snapshot, not live FK. Each ref is
--   { chunk_id, document_id, quote, section_heading, page_start, page_end }
-- denormalized at attach time (the visit_requirements precedent). Renderers
-- read the snapshot; a later re-parse of the protocol cannot mutate or orphan
-- a finding's citation. chunk_id/document_id are provenance breadcrumbs, not
-- dependencies — the DB validates SHAPE only. Membership (the quote really
-- comes from THIS audit's protocol) is enforced where refs are born:
--   * the isa-finding-draft edge function's Gate 3 (candidate-set membership
--     + verbatim-substring check), and
--   * audit_mode_search_isa_protocol_chunks below, which only ever returns
--     chunks of the calling auditor's own audit's protocol.
-- Validating chunk liveness on every later edit would make findings fail
-- years after a re-parse; the snapshot stance avoids that class entirely.
--
-- RLS note for review: chunks/documents RLS is owner-only
-- (documents.user_id), and the auditor is usually not the uploader. The two
-- new functions are SECURITY DEFINER with an explicit
-- lead_auditor_id = auth.uid() gate, joining documents through
-- audits.protocol_id — the same authorization derivation dashboard-chat uses
-- (user_can_access_protocol check, then service-role read). No RLS policy on
-- chunks/documents is altered.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Column
-- -----------------------------------------------------------------------------
ALTER TABLE isa_finding_objects
  ADD COLUMN protocol_refs JSONB NOT NULL DEFAULT '[]'::jsonb
  CONSTRAINT isa_finding_protocol_refs_is_array CHECK (jsonb_typeof(protocol_refs) = 'array');


-- -----------------------------------------------------------------------------
-- audit_mode_validate_isa_protocol_refs — shape validation (see header for
-- why shape-only). Caps: ≤6 refs, quote 1..500 chars.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_validate_isa_protocol_refs(
  p_refs jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_uuid uuid;
BEGIN
  IF jsonb_typeof(p_refs) <> 'array' THEN
    RAISE EXCEPTION 'protocol_refs must be a JSON array' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(p_refs) > 6 THEN
    RAISE EXCEPTION 'protocol_refs is capped at 6 citations' USING ERRCODE = '23514';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_refs) LOOP
    IF jsonb_typeof(v_item->'quote') <> 'string'
       OR length(btrim(v_item->>'quote')) = 0
       OR length(v_item->>'quote') > 500 THEN
      RAISE EXCEPTION 'each protocol ref needs a non-empty quote of at most 500 characters'
        USING ERRCODE = '23514';
    END IF;
    -- Breadcrumbs must at least be well-formed when present.
    IF v_item ? 'chunk_id' AND jsonb_typeof(v_item->'chunk_id') <> 'null' THEN
      BEGIN
        v_uuid := (v_item->>'chunk_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'protocol ref chunk_id must be a uuid' USING ERRCODE = '23514';
      END;
    END IF;
    IF v_item ? 'document_id' AND jsonb_typeof(v_item->'document_id') <> 'null' THEN
      BEGIN
        v_uuid := (v_item->>'document_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'protocol ref document_id must be a uuid' USING ERRCODE = '23514';
      END;
    END IF;
    IF v_item ? 'page_start' AND jsonb_typeof(v_item->'page_start') NOT IN ('null', 'number') THEN
      RAISE EXCEPTION 'protocol ref page_start must be a number' USING ERRCODE = '23514';
    END IF;
    IF v_item ? 'page_end' AND jsonb_typeof(v_item->'page_end') NOT IN ('null', 'number') THEN
      RAISE EXCEPTION 'protocol ref page_end must be a number' USING ERRCODE = '23514';
    END IF;
    IF v_item ? 'section_heading' AND jsonb_typeof(v_item->'section_heading') NOT IN ('null', 'string') THEN
      RAISE EXCEPTION 'protocol ref section_heading must be a string' USING ERRCODE = '23514';
    END IF;
  END LOOP;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_create_isa_finding — replacement adding p_protocol_refs.
-- DROP first: the parameter list changes, and CREATE OR REPLACE with a new
-- signature would create an ambiguous overload instead of replacing.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS audit_mode_create_isa_finding(
  uuid, text, isa_domain, isa_severity, text, jsonb, isa_finding_origin,
  text, text, text, isa_response_owner, text
);

CREATE FUNCTION audit_mode_create_isa_finding(
  p_audit_id       uuid,
  p_title          text,
  p_isa_domain     isa_domain,
  p_severity       isa_severity,
  p_observation    text,
  p_evidence       jsonb,
  p_origin         isa_finding_origin,
  p_subcategory    text               DEFAULT NULL,
  p_severity_rule  text               DEFAULT NULL,
  p_reference      text               DEFAULT NULL,
  p_response_owner isa_response_owner DEFAULT 'SITE',
  p_protocol_refs  jsonb              DEFAULT '[]'::jsonb,
  p_reason         text               DEFAULT NULL
)
RETURNS isa_finding_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_workflow audit_workflow_type;
  v_note_ids uuid[];
  v_after    isa_finding_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title must not be empty' USING ERRCODE = '23514';
  END IF;
  IF length(btrim(p_observation)) = 0 THEN
    RAISE EXCEPTION 'observation must not be empty' USING ERRCODE = '23514';
  END IF;

  SELECT workflow_type INTO v_workflow FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;
  IF v_workflow <> 'INVESTIGATOR_SITE_AUDIT' THEN
    RAISE EXCEPTION 'ISA findings are only available on investigator site audits'
      USING ERRCODE = '23514';
  END IF;

  v_note_ids := audit_mode_validate_isa_evidence(p_audit_id, p_evidence, NULL);
  PERFORM audit_mode_validate_isa_protocol_refs(p_protocol_refs);

  IF p_origin <> 'AUDITOR'
     AND (array_length(v_note_ids, 1) IS NULL OR jsonb_array_length(p_evidence) = 0) THEN
    RAISE EXCEPTION 'PIQC-drafted findings must cite at least one source note'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO isa_finding_objects (
    audit_id, title, isa_domain, subcategory, severity, severity_rule,
    observation, evidence, reference, protocol_refs, response_owner, origin, created_by
  ) VALUES (
    p_audit_id, btrim(p_title), p_isa_domain, NULLIF(btrim(COALESCE(p_subcategory, '')), ''),
    p_severity, NULLIF(btrim(COALESCE(p_severity_rule, '')), ''),
    btrim(p_observation), p_evidence, NULLIF(btrim(COALESCE(p_reference, '')), ''),
    p_protocol_refs, p_response_owner, p_origin, v_user
  )
  RETURNING * INTO v_after;

  -- Promote the cited notes — atomic with the finding insert.
  IF array_length(v_note_ids, 1) IS NOT NULL THEN
    UPDATE audit_note_objects
       SET promoted_finding_id = v_after.id
     WHERE id = ANY(v_note_ids);
  END IF;

  PERFORM audit_mode_write_delta(
    'ISA_FINDING_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'title',         jsonb_build_object('from', NULL, 'to', v_after.title),
      'isa_domain',    jsonb_build_object('from', NULL, 'to', v_after.isa_domain),
      'severity',      jsonb_build_object('from', NULL, 'to', v_after.severity),
      'observation',   jsonb_build_object('from', NULL, 'to', v_after.observation),
      'evidence',      jsonb_build_object('from', NULL, 'to', v_after.evidence),
      'reference',     jsonb_build_object('from', NULL, 'to', v_after.reference),
      'protocol_refs', jsonb_build_object('from', NULL, 'to', v_after.protocol_refs),
      'origin',        jsonb_build_object('from', NULL, 'to', v_after.origin)
    ),
    v_user,
    COALESCE(p_reason, 'Finding created')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_update_isa_finding — replacement adding p_protocol_refs.
-- NULL = unchanged; '[]' = clear all refs. A refs change is a content change
-- for origin honesty (the citation is part of the finding's substance).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS audit_mode_update_isa_finding(
  uuid, text, isa_domain, text, boolean, isa_severity, text, boolean,
  text, jsonb, text, boolean, isa_response_owner, text
);

CREATE FUNCTION audit_mode_update_isa_finding(
  p_id                  uuid,
  p_title               text               DEFAULT NULL,
  p_isa_domain          isa_domain         DEFAULT NULL,
  p_subcategory         text               DEFAULT NULL,
  p_clear_subcategory   boolean            DEFAULT FALSE,
  p_severity            isa_severity       DEFAULT NULL,
  p_severity_rule       text               DEFAULT NULL,
  p_clear_severity_rule boolean            DEFAULT FALSE,
  p_observation         text               DEFAULT NULL,
  p_evidence            jsonb              DEFAULT NULL,
  p_reference           text               DEFAULT NULL,
  p_clear_reference     boolean            DEFAULT FALSE,
  p_response_owner      isa_response_owner DEFAULT NULL,
  p_protocol_refs       jsonb              DEFAULT NULL,
  p_reason              text               DEFAULT NULL
)
RETURNS isa_finding_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user            uuid := auth.uid();
  v_before          isa_finding_objects;
  v_after           isa_finding_objects;
  v_note_ids        uuid[];
  v_delta           jsonb := '{}'::jsonb;
  v_content_changed boolean := FALSE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM isa_finding_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finding % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  IF p_title IS NOT NULL AND length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title must not be empty' USING ERRCODE = '23514';
  END IF;
  IF p_observation IS NOT NULL AND length(btrim(p_observation)) = 0 THEN
    RAISE EXCEPTION 'observation must not be empty' USING ERRCODE = '23514';
  END IF;

  IF p_evidence IS NOT NULL THEN
    v_note_ids := audit_mode_validate_isa_evidence(v_before.audit_id, p_evidence, p_id);
  END IF;
  IF p_protocol_refs IS NOT NULL THEN
    PERFORM audit_mode_validate_isa_protocol_refs(p_protocol_refs);
  END IF;

  UPDATE isa_finding_objects
     SET title          = COALESCE(btrim(p_title), title),
         isa_domain     = COALESCE(p_isa_domain, isa_domain),
         subcategory    = CASE WHEN p_clear_subcategory THEN NULL
                               ELSE COALESCE(NULLIF(btrim(COALESCE(p_subcategory, '')), ''), subcategory) END,
         severity       = COALESCE(p_severity, severity),
         severity_rule  = CASE WHEN p_clear_severity_rule THEN NULL
                               ELSE COALESCE(NULLIF(btrim(COALESCE(p_severity_rule, '')), ''), severity_rule) END,
         observation    = COALESCE(btrim(p_observation), observation),
         evidence       = COALESCE(p_evidence, evidence),
         reference      = CASE WHEN p_clear_reference THEN NULL
                               ELSE COALESCE(NULLIF(btrim(COALESCE(p_reference, '')), ''), reference) END,
         response_owner = COALESCE(p_response_owner, response_owner),
         protocol_refs  = COALESCE(p_protocol_refs, protocol_refs)
   WHERE id = p_id
  RETURNING * INTO v_after;

  -- Promotion re-sync on evidence change.
  IF p_evidence IS NOT NULL THEN
    UPDATE audit_note_objects
       SET promoted_finding_id = NULL
     WHERE promoted_finding_id = p_id
       AND NOT (id = ANY(COALESCE(v_note_ids, '{}'::uuid[])));
    IF array_length(v_note_ids, 1) IS NOT NULL THEN
      UPDATE audit_note_objects
         SET promoted_finding_id = p_id
       WHERE id = ANY(v_note_ids);
    END IF;
  END IF;

  IF v_before.title IS DISTINCT FROM v_after.title THEN
    v_delta := v_delta || jsonb_build_object('title',
      jsonb_build_object('from', v_before.title, 'to', v_after.title));
    v_content_changed := TRUE;
  END IF;
  IF v_before.isa_domain IS DISTINCT FROM v_after.isa_domain THEN
    v_delta := v_delta || jsonb_build_object('isa_domain',
      jsonb_build_object('from', v_before.isa_domain, 'to', v_after.isa_domain));
    v_content_changed := TRUE;
  END IF;
  IF v_before.subcategory IS DISTINCT FROM v_after.subcategory THEN
    v_delta := v_delta || jsonb_build_object('subcategory',
      jsonb_build_object('from', v_before.subcategory, 'to', v_after.subcategory));
    v_content_changed := TRUE;
  END IF;
  IF v_before.severity IS DISTINCT FROM v_after.severity THEN
    v_delta := v_delta || jsonb_build_object('severity',
      jsonb_build_object('from', v_before.severity, 'to', v_after.severity));
    v_content_changed := TRUE;
  END IF;
  IF v_before.severity_rule IS DISTINCT FROM v_after.severity_rule THEN
    v_delta := v_delta || jsonb_build_object('severity_rule',
      jsonb_build_object('from', v_before.severity_rule, 'to', v_after.severity_rule));
  END IF;
  IF v_before.observation IS DISTINCT FROM v_after.observation THEN
    v_delta := v_delta || jsonb_build_object('observation',
      jsonb_build_object('from', v_before.observation, 'to', v_after.observation));
    v_content_changed := TRUE;
  END IF;
  IF v_before.evidence IS DISTINCT FROM v_after.evidence THEN
    v_delta := v_delta || jsonb_build_object('evidence',
      jsonb_build_object('from', v_before.evidence, 'to', v_after.evidence));
    v_content_changed := TRUE;
  END IF;
  IF v_before.reference IS DISTINCT FROM v_after.reference THEN
    v_delta := v_delta || jsonb_build_object('reference',
      jsonb_build_object('from', v_before.reference, 'to', v_after.reference));
    v_content_changed := TRUE;
  END IF;
  IF v_before.protocol_refs IS DISTINCT FROM v_after.protocol_refs THEN
    v_delta := v_delta || jsonb_build_object('protocol_refs',
      jsonb_build_object('from', v_before.protocol_refs, 'to', v_after.protocol_refs));
    v_content_changed := TRUE;
  END IF;
  IF v_before.response_owner IS DISTINCT FROM v_after.response_owner THEN
    v_delta := v_delta || jsonb_build_object('response_owner',
      jsonb_build_object('from', v_before.response_owner, 'to', v_after.response_owner));
  END IF;

  -- Provenance honesty: first content edit de-attributes the pure draft.
  IF v_content_changed AND v_before.origin = 'PIQC_DRAFTED' THEN
    UPDATE isa_finding_objects SET origin = 'PIQC_EDITED' WHERE id = p_id
    RETURNING * INTO v_after;
    v_delta := v_delta || jsonb_build_object('origin',
      jsonb_build_object('from', v_before.origin, 'to', v_after.origin));
  END IF;

  IF v_delta <> '{}'::jsonb THEN
    PERFORM audit_mode_write_delta(
      'ISA_FINDING_OBJECT'::tracked_object_type,
      v_after.id,
      v_delta,
      v_user,
      COALESCE(p_reason, 'Finding updated')
    );
  END IF;

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_search_isa_protocol_chunks — the manual picker's search.
--
-- SECURITY DEFINER on purpose: chunk RLS is owner-only and the auditor is
-- usually not the uploader. The gate is audit ownership; the reachable rows
-- are exactly the ready documents of the caller's own audit's protocol.
-- FTS over chunks.fts (plainto, the repo convention) + a section-heading
-- ILIKE assist for queries like "6.3" that FTS tokenizes poorly.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_search_isa_protocol_chunks(
  p_audit_id uuid,
  p_query    text,
  p_limit    integer DEFAULT 8
)
RETURNS TABLE (
  chunk_id        uuid,
  document_id     uuid,
  snippet         text,
  section_heading text,
  page_start      integer,
  page_end        integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_protocol_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_query, ''))) = 0 THEN
    RETURN;
  END IF;

  SELECT a.protocol_id INTO v_protocol_id
    FROM audits a
   WHERE a.id = p_audit_id
     AND a.lead_auditor_id = auth.uid()
     AND a.workflow_type = 'INVESTIGATOR_SITE_AUDIT';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    LEFT(c.content, 600),
    c.section_heading,
    c.page_start,
    c.page_end
  FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE d.protocol_id = v_protocol_id
    AND d.status = 'ready'
    AND (c.is_boilerplate IS NULL OR c.is_boilerplate = false)
    AND (c.fts @@ plainto_tsquery('english', p_query)
         OR c.section_heading ILIKE '%' || btrim(p_query) || '%')
  ORDER BY ts_rank_cd(c.fts, plainto_tsquery('english', p_query)) DESC,
           c.document_id, c.chunk_index
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_isa_protocol_bridge_status — ready parsed-document count for the
-- audit's protocol. Drives silent-with-signal: 0 → no picker, no proposals,
-- one nudge line. SECURITY DEFINER for the same owner-only-RLS reason.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_isa_protocol_bridge_status(
  p_audit_id uuid
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_protocol_id uuid;
  v_count       integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT a.protocol_id INTO v_protocol_id
    FROM audits a
   WHERE a.id = p_audit_id
     AND a.lead_auditor_id = auth.uid()
     AND a.workflow_type = 'INVESTIGATOR_SITE_AUDIT';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)::integer INTO v_count
    FROM documents d
   WHERE d.protocol_id = v_protocol_id
     AND d.status = 'ready';

  RETURN v_count;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants. The definer functions are gated internally on audit ownership;
-- authenticated-only execution.
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_validate_isa_protocol_refs(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_create_isa_finding(
  uuid, text, isa_domain, isa_severity, text, jsonb, isa_finding_origin,
  text, text, text, isa_response_owner, jsonb, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_update_isa_finding(
  uuid, text, isa_domain, text, boolean, isa_severity, text, boolean,
  text, jsonb, text, boolean, isa_response_owner, jsonb, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_search_isa_protocol_chunks(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_isa_protocol_bridge_status(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION audit_mode_search_isa_protocol_chunks(uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION audit_mode_isa_protocol_bridge_status(uuid) FROM anon;
