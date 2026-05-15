-- =============================================================================
-- Audit Mode — onramp RPCs (F-1)
--
-- Surfaces the engine to independent audit contractors so they can:
--   1. Add a vendor they audit (independent of Site Mode)
--   2. Promote an uploaded protocol PDF into a structured protocol +
--      protocol_version record they can audit against
--   3. Create a new audit row tying vendor + protocol + auditor together
--
-- Product positioning: Audit Mode is purchased independently from Site Mode.
-- These RPCs serve audit contractors directly — no Site Mode UI assumptions.
-- Shared backend engine, unshared product surface.
--
-- All three RPCs are SECURITY DEFINER because vendors / protocols /
-- protocol_versions have SELECT-only RLS today (audit_mode_phase_1_rls).
-- The audits table has self-INSERT RLS so audit creation could be INVOKER —
-- kept DEFINER for symmetry and explicit auditor gating.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_mode_create_vendor
--
-- Creates a vendor record. Decision Debt: vendors are globally readable today
-- (no created_by column). For V1, audit contractors share the vendor namespace.
-- Multi-tenant vendor isolation is a future refinement when org/tenant model
-- lands. Auditors are advised (UI copy) that vendor names are shared.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_vendor(
  p_name       text,
  p_country    text,
  p_legal_name text DEFAULT NULL,
  p_website    text DEFAULT NULL
)
RETURNS vendors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row  vendors;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF length(btrim(p_name)) = 0 OR length(btrim(p_country)) = 0 THEN
    RAISE EXCEPTION 'Vendor name and country are required'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO vendors (name, legal_name, country, website)
  VALUES (
    btrim(p_name),
    NULLIF(btrim(COALESCE(p_legal_name, '')), ''),
    btrim(p_country),
    NULLIF(btrim(COALESCE(p_website, '')), '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_create_protocol_from_document
--
-- Promotes a previously-uploaded `documents` row into a structured protocol
-- + protocol_version pair the auditor can audit against. Two paths:
--
--   (a) Document already auto-tagged (documents.protocol_id IS NOT NULL):
--       returns the matched protocol's latest version. No-op on protocols.
--
--   (b) Document not auto-tagged: creates a new protocols row and an initial
--       protocol_versions row (version 1, ACTIVE). The auditor must supply
--       title + sponsor + (optional) study_number + phase. The full
--       documents.extracted_fields is captured as raw_piqc_payload for
--       traceability (the D-009 stub placeholder).
--
-- Gating: caller must be the document uploader (documents.user_id = auth.uid()).
-- Prevents an auditor from creating a protocol from someone else's PDF.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_protocol_from_document(
  p_document_id  uuid,
  p_title        text                 DEFAULT NULL,
  p_sponsor      text                 DEFAULT NULL,
  p_study_number text                 DEFAULT NULL,
  p_phase        clinical_trial_phase DEFAULT 'NOT_APPLICABLE'
)
RETURNS protocol_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_doc         documents;
  v_protocol    protocols;
  v_version     protocol_versions;
  v_study_norm  text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc FROM documents WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document % not found', p_document_id USING ERRCODE = 'P0002';
  END IF;

  IF v_doc.user_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'Document % does not belong to you', p_document_id
      USING ERRCODE = '42501';
  END IF;

  -- Path (a): document is already linked to a protocol — return its latest
  -- ACTIVE version (or the highest version_number if none are ACTIVE).
  IF v_doc.protocol_id IS NOT NULL THEN
    SELECT * INTO v_version
      FROM protocol_versions
     WHERE protocol_id = v_doc.protocol_id
     ORDER BY (status = 'ACTIVE') DESC, version_number DESC
     LIMIT 1;

    IF FOUND THEN
      RETURN v_version;
    END IF;
    -- Protocol row exists but has no versions — fall through to create v1.
    SELECT * INTO v_protocol FROM protocols WHERE id = v_doc.protocol_id;
  ELSE
    -- Path (b): create a new protocols row. Title + sponsor required.
    IF p_title IS NULL OR length(btrim(p_title)) = 0 THEN
      RAISE EXCEPTION 'Protocol title is required when the document is not auto-tagged'
        USING ERRCODE = '23514';
    END IF;
    IF p_sponsor IS NULL OR length(btrim(p_sponsor)) = 0 THEN
      RAISE EXCEPTION 'Protocol sponsor is required when the document is not auto-tagged'
        USING ERRCODE = '23514';
    END IF;

    v_study_norm := normalize_protocol_number(p_study_number);

    -- If a protocol with the same normalized study_number already exists,
    -- reuse it rather than creating a duplicate. Audit contractors auditing
    -- multiple vendors on the same sponsor protocol benefit from this.
    IF v_study_norm IS NOT NULL AND v_study_norm <> '' THEN
      SELECT * INTO v_protocol
        FROM protocols
       WHERE study_number_normalized = v_study_norm
       LIMIT 1;
    END IF;

    IF v_protocol.id IS NULL THEN
      INSERT INTO protocols (study_number, title, sponsor)
      VALUES (
        NULLIF(btrim(COALESCE(p_study_number, '')), ''),
        btrim(p_title),
        btrim(p_sponsor)
      )
      RETURNING * INTO v_protocol;
    END IF;

    -- Link the document to the protocol so future cross-stage features
    -- (SOTR drawer, autotag) read consistently.
    UPDATE documents SET protocol_id = v_protocol.id WHERE id = p_document_id;
  END IF;

  -- Create the initial ACTIVE protocol_version. piqc_protocol_id is a [PIQC]
  -- D-009 stub — use the document id as a stable placeholder until the
  -- formal PIQC payload contract lands. raw_piqc_payload carries whatever
  -- Reducto extracted on ingest (may be empty if extraction hasn't completed).
  INSERT INTO protocol_versions (
    protocol_id, version_number, status, effective_date,
    clinical_trial_phase, piqc_protocol_id, raw_piqc_payload
  ) VALUES (
    v_protocol.id,
    1,
    'ACTIVE',
    NULL,
    COALESCE(p_phase, 'NOT_APPLICABLE'::clinical_trial_phase),
    p_document_id::text,
    COALESCE(v_doc.extracted_fields, '{}'::jsonb)
  )
  RETURNING * INTO v_version;

  RETURN v_version;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_create_audit
--
-- Inserts the audits row tying together a vendor, a protocol version, and
-- the auditor. Sets lead_auditor_id = auth.uid() (single-auditor product per
-- F-006). Defaults: status = IN_PROGRESS, current_stage = INTAKE.
--
-- Caller passes protocol_version_id (not protocol_id) because the audit is
-- pinned to a specific version. The companion protocol_id is derived.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_audit(
  p_audit_name          text,
  p_vendor_id           uuid,
  p_protocol_version_id uuid,
  p_audit_type          audit_type,
  p_scheduled_date      date DEFAULT NULL
)
RETURNS audits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_protocol_id uuid;
  v_audit       audits;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF length(btrim(p_audit_name)) = 0 THEN
    RAISE EXCEPTION 'Audit name is required' USING ERRCODE = '23514';
  END IF;

  -- Resolve protocol_id from the version FK.
  SELECT protocol_id INTO v_protocol_id
    FROM protocol_versions
   WHERE id = p_protocol_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Protocol version % not found', p_protocol_version_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Vendor existence check.
  IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = p_vendor_id) THEN
    RAISE EXCEPTION 'Vendor % not found', p_vendor_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO audits (
    vendor_id, protocol_id, protocol_version_id,
    audit_name, audit_type, status, current_stage,
    lead_auditor_id, scheduled_date
  ) VALUES (
    p_vendor_id, v_protocol_id, p_protocol_version_id,
    btrim(p_audit_name), p_audit_type, 'IN_PROGRESS', 'INTAKE',
    v_user, p_scheduled_date
  )
  RETURNING * INTO v_audit;

  RETURN v_audit;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_create_vendor(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_create_protocol_from_document(uuid, text, text, text, clinical_trial_phase) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_create_audit(text, uuid, uuid, audit_type, date) TO authenticated;
