-- =============================================================================
-- Audit Mode — audit-level source evidence register (PR-B, text/paste slice)
--
-- Evidence (most importantly the vendor's completed questionnaire) arrives as
-- emailed files at any audit stage. This migration gives every audit a register
-- built on the EXISTING documents+chunks pipeline — no third evidence model:
--
--   documents.kind          — 'PROTOCOL' (default, all existing rows) vs
--                             'AUDIT_EVIDENCE' (paste-ingested via /ingest with
--                             kind, protocol_id stays NULL so evidence never
--                             leaks into protocol-scoped chat/search).
--   audit_source_documents  — join row per attachment carrying audit-scoped
--                             provenance: what it is (source_type), where the
--                             human got it (source_system — no UI in v1, NULL =
--                             not recorded), and a locator. include_in_generation
--                             is the withhold-never-delete lever PR-C's grounded
--                             generation reads.
--
-- Attach/remove are SECURITY INVOKER RPCs writing 'AUDIT' deltas atomically
-- (house contract — audit_mode_write_delta, RLS-validated actor). Document-
-- scoped facts (content_hash, filename, status) stay on documents; the join
-- row never duplicates them.
-- =============================================================================

CREATE TYPE document_kind AS ENUM ('PROTOCOL', 'AUDIT_EVIDENCE');

ALTER TABLE documents
  ADD COLUMN kind document_kind NOT NULL DEFAULT 'PROTOCOL';

-- Defensive: protocol autotagging must never claim an evidence document.
-- Today the trigger already no-ops on evidence (text path writes no
-- extracted_fields), so this is belt-and-braces, not a behavior change.
CREATE OR REPLACE FUNCTION documents_autotag_protocol()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
BEGIN
  IF NEW.kind <> 'PROTOCOL' THEN
    RETURN NEW;
  END IF;
  IF NEW.protocol_id IS NULL
     AND NEW.extracted_fields IS NOT NULL
     AND NEW.extracted_fields ? 'protocol_number' THEN
    candidate := normalize_protocol_number(NEW.extracted_fields->>'protocol_number');
    IF candidate IS NOT NULL AND candidate <> '' THEN
      SELECT id INTO NEW.protocol_id
      FROM protocols
      WHERE study_number_normalized = candidate
      LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_source_documents — the register
-- -----------------------------------------------------------------------------
CREATE TABLE audit_source_documents (
  audit_id    uuid NOT NULL REFERENCES audits(id)     ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id)  ON DELETE CASCADE,
  added_by    uuid NOT NULL REFERENCES auth.users(id),
  added_at    timestamptz NOT NULL DEFAULT now(),

  source_type    text NOT NULL,  -- what it is (free text; UI offers preset chips)
  source_system  text,           -- where the human obtained it (no UI in v1; NULL = not recorded)
  source_locator text,           -- doc number / binder path / URL

  include_in_generation boolean NOT NULL DEFAULT TRUE,

  PRIMARY KEY (audit_id, document_id)
);

-- Reverse lookup: remove RPC's still-referenced-elsewhere check + FK cascades.
CREATE INDEX audit_source_documents_document_id_idx
  ON audit_source_documents (document_id);

ALTER TABLE audit_source_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_source_documents_via_audit"
  ON audit_source_documents FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid())
               AND added_by = auth.uid());


-- -----------------------------------------------------------------------------
-- audit_mode_attach_evidence
--
-- Files an already-ingested AUDIT_EVIDENCE document under an audit. Idempotent:
-- re-attaching returns the existing row and writes no second delta. Named
-- trade-off: a client dying between /ingest and this call orphans a document
-- (invisible to every register; GC later).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_attach_evidence(
  p_audit_id       uuid,
  p_document_id    uuid,
  p_source_type    text,
  p_source_system  text DEFAULT NULL,
  p_source_locator text DEFAULT NULL
)
RETURNS audit_source_documents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user      uuid := auth.uid();
  v_doc_kind  document_kind;
  v_doc_owner uuid;
  v_doc_title text;
  v_after     audit_source_documents;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF length(btrim(coalesce(p_source_type, ''))) = 0 THEN
    RAISE EXCEPTION 'source_type must not be empty' USING ERRCODE = '23514';
  END IF;

  -- RLS hides other auditors' audits — NOT FOUND covers missing and
  -- inaccessible ids alike.
  PERFORM 1 FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  -- Same for documents (RLS: user_id = auth.uid()).
  SELECT kind, user_id, title INTO v_doc_kind, v_doc_owner, v_doc_title
  FROM documents WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document % not found', p_document_id USING ERRCODE = 'P0002';
  END IF;
  IF v_doc_owner <> v_user THEN
    RAISE EXCEPTION 'Document % is not owned by the caller', p_document_id
      USING ERRCODE = '42501';
  END IF;
  IF v_doc_kind <> 'AUDIT_EVIDENCE' THEN
    RAISE EXCEPTION 'Only AUDIT_EVIDENCE documents can be attached (got %)', v_doc_kind
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO audit_source_documents
    (audit_id, document_id, added_by, source_type, source_system, source_locator)
  VALUES
    (p_audit_id, p_document_id, v_user, btrim(p_source_type),
     nullif(btrim(coalesce(p_source_system, '')), ''),
     nullif(btrim(coalesce(p_source_locator, '')), ''))
  ON CONFLICT (audit_id, document_id) DO NOTHING
  RETURNING * INTO v_after;

  IF v_after.audit_id IS NOT NULL THEN
    -- Actual insert — record it. (write_delta no-ops on empty JSONB, so the
    -- payload must be real.)
    PERFORM audit_mode_write_delta(
      'AUDIT'::tracked_object_type,
      p_audit_id,
      jsonb_build_object(
        'evidence_attached', jsonb_build_object(
          'from', NULL,
          'to', jsonb_build_object(
            'document_id', p_document_id,
            'title',       v_doc_title,
            'source_type', v_after.source_type
          )
        )
      ),
      v_user,
      'Evidence attached'
    );
  ELSE
    -- Already attached — idempotent success, no second delta.
    SELECT * INTO v_after FROM audit_source_documents
    WHERE audit_id = p_audit_id AND document_id = p_document_id;
  END IF;

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_remove_evidence
--
-- Deletes the join row, then the evidence document itself (chunks cascade) —
-- but ONLY when no other register still references the document: attach is a
-- public RPC, so one document can be filed under two audits, and an
-- unconditional delete would silently gut the other audit's register.
-- PR-C locks removal to withhold-only once a deliverable has grounded on the
-- document; until then removal is honest mistake-recovery, recorded as a delta.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_remove_evidence(
  p_audit_id    uuid,
  p_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user      uuid := auth.uid();
  v_join      audit_source_documents;
  v_doc_kind  document_kind;
  v_doc_title text;
  v_elsewhere boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_join FROM audit_source_documents
  WHERE audit_id = p_audit_id AND document_id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evidence % is not attached to audit %', p_document_id, p_audit_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT kind, title INTO v_doc_kind, v_doc_title
  FROM documents WHERE id = p_document_id;
  IF v_doc_kind <> 'AUDIT_EVIDENCE' THEN
    -- Programmer-error guard: the register must never delete a protocol.
    RAISE EXCEPTION 'Document % is not AUDIT_EVIDENCE (got %)', p_document_id, v_doc_kind
      USING ERRCODE = '23514';
  END IF;

  DELETE FROM audit_source_documents
  WHERE audit_id = p_audit_id AND document_id = p_document_id;

  SELECT EXISTS (
    SELECT 1 FROM audit_source_documents WHERE document_id = p_document_id
  ) INTO v_elsewhere;

  IF NOT v_elsewhere THEN
    DELETE FROM documents
    WHERE id = p_document_id AND kind = 'AUDIT_EVIDENCE';
  END IF;

  PERFORM audit_mode_write_delta(
    'AUDIT'::tracked_object_type,
    p_audit_id,
    jsonb_build_object(
      'evidence_removed', jsonb_build_object(
        'from', jsonb_build_object(
          'document_id', p_document_id,
          'title',       v_doc_title,
          'source_type', v_join.source_type
        ),
        'to', NULL
      )
    ),
    v_user,
    'Evidence removed'
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_attach_evidence(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_remove_evidence(uuid, uuid) TO authenticated;
