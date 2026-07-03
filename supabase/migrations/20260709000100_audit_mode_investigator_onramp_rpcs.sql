-- =============================================================================
-- Audit Mode — Investigator Site Audit (ISA) onramp RPCs
--
-- Companion to 20260709000000. Runs in a later transaction so it can reference
-- the ISA_SITE_INTAKE stage value added there.
--
--   1. audit_mode_create_site — creates the investigator auditee, mirroring
--      audit_mode_create_vendor (SECURITY DEFINER; sites is SELECT-only RLS).
--   2. audit_mode_create_audit — generalized for both workflows. The old 5-arg
--      signature is DROPped and replaced with a 7-arg version adding
--      p_workflow_type + p_site_id (p_vendor_id now optional). DROP (not just
--      REPLACE) avoids an ambiguous overload: a 5-named-param call would
--      otherwise match both signatures. The new params default to the vendor
--      path, so a currently-deployed vendor frontend keeps working unchanged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- audit_mode_create_site — mirrors audit_mode_create_vendor.
-- Shared namespace; INSERT gated here because `sites` is SELECT-only under RLS.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_site(
  p_name                   text,
  p_country                text,
  p_site_number            text DEFAULT NULL,
  p_principal_investigator text DEFAULT NULL
)
RETURNS sites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row  sites;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF length(btrim(p_name)) = 0 OR length(btrim(p_country)) = 0 THEN
    RAISE EXCEPTION 'Site name and country are required'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO sites (name, site_number, principal_investigator, country)
  VALUES (
    btrim(p_name),
    NULLIF(btrim(COALESCE(p_site_number, '')), ''),
    NULLIF(btrim(COALESCE(p_principal_investigator, '')), ''),
    btrim(p_country)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- -----------------------------------------------------------------------------
-- audit_mode_create_audit — one create RPC for both workflows.
--
-- Vendor audits pass a vendor; investigator site audits pass a site. The RPC
-- enforces the auditee/workflow pairing (matching the audits_auditee_matches_
-- workflow CHECK), nulls the other auditee for mutual exclusion, and lands the
-- audit at the workflow's first stage (INTAKE vs ISA_SITE_INTAKE).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS audit_mode_create_audit(text, uuid, uuid, audit_type, date);

CREATE OR REPLACE FUNCTION audit_mode_create_audit(
  p_audit_name          text,
  p_vendor_id           uuid,
  p_protocol_version_id uuid,
  p_audit_type          audit_type,
  p_scheduled_date      date                DEFAULT NULL,
  p_workflow_type       audit_workflow_type DEFAULT 'VENDOR_AUDIT',
  p_site_id             uuid                DEFAULT NULL
)
RETURNS audits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_protocol_id uuid;
  v_stage       audit_stage;
  v_audit       audits;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF length(btrim(p_audit_name)) = 0 THEN
    RAISE EXCEPTION 'Audit name is required' USING ERRCODE = '23514';
  END IF;

  -- Resolve protocol_id from the version FK — both workflows audit a protocol.
  SELECT protocol_id INTO v_protocol_id
    FROM protocol_versions
   WHERE id = p_protocol_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Protocol version % not found', p_protocol_version_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Auditee must match the workflow; null the other side for the CHECK.
  IF p_workflow_type = 'VENDOR_AUDIT' THEN
    IF p_vendor_id IS NULL THEN
      RAISE EXCEPTION 'A vendor is required for a vendor audit'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = p_vendor_id) THEN
      RAISE EXCEPTION 'Vendor % not found', p_vendor_id USING ERRCODE = 'P0002';
    END IF;
    p_site_id := NULL;
    v_stage   := 'INTAKE';
  ELSE  -- INVESTIGATOR_SITE_AUDIT
    IF p_site_id IS NULL THEN
      RAISE EXCEPTION 'A site is required for an investigator site audit'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id) THEN
      RAISE EXCEPTION 'Site % not found', p_site_id USING ERRCODE = 'P0002';
    END IF;
    p_vendor_id := NULL;
    v_stage     := 'ISA_SITE_INTAKE';
  END IF;

  INSERT INTO audits (
    vendor_id, site_id, protocol_id, protocol_version_id,
    audit_name, audit_type, workflow_type, status, current_stage,
    lead_auditor_id, scheduled_date
  ) VALUES (
    p_vendor_id, p_site_id, v_protocol_id, p_protocol_version_id,
    btrim(p_audit_name), p_audit_type, p_workflow_type, 'IN_PROGRESS', v_stage,
    v_user, p_scheduled_date
  )
  RETURNING * INTO v_audit;

  RETURN v_audit;
END;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_create_site(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_create_audit(text, uuid, uuid, audit_type, date, audit_workflow_type, uuid) TO authenticated;
