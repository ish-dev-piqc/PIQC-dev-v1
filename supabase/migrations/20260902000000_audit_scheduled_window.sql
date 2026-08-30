-- =============================================================================
-- Audit Mode — scheduled window & reschedule (PR-UX1).
--
-- audits.scheduled_date was written exactly once, at creation, with no update
-- path anywhere (no RPC, no API writer, no UI) and no end-date column — a
-- 3-day on-site audit could not be represented and a rescheduled audit could
-- not be corrected. Rescheduling is an expected workflow event (generated
-- deliverables describe dates as proposed until the auditee confirms), so an
-- immutable date is a defect, not a safeguard.
--
-- This migration:
--   1. Adds audits.scheduled_end_date. Absent end date = single-day audit, so
--      every existing row is already valid under the CHECK.
--   2. Makes audit_mode_reschedule_audit the SOLE writer of both date columns,
--      continuing 20260721000100's doctrine (column-level privileges +
--      SECURITY DEFINER RPC): the column grant is restated WITHOUT
--      scheduled_date and without scheduled_end_date, so a direct PostgREST
--      PATCH cannot dodge the delta trail. Verified: nothing in src/ UPDATEs
--      audits directly (reads only), so no client behavior changes.
--   3. Extends audit_mode_create_audit with an optional end date. The old
--      7-param signature is dropped to avoid PostgREST overload ambiguity.
--
-- Every reschedule writes a readable 'AUDIT' delta (flattened window strings —
-- HistoryDrawer renders object values as raw JSON, so values are plain text).
-- Reason is optional: rescheduling is routine; the delta is the provenance.
--
-- TS mirror: src/types/audit/objects.ts (Audit.scheduled_end_date).
--
-- Owner: @rv61.
-- =============================================================================

-- 1. Window column. NULL end = single-day (or unscheduled) — no backfill.
ALTER TABLE audits ADD COLUMN scheduled_end_date DATE;

ALTER TABLE audits ADD CONSTRAINT audits_window_valid CHECK (
  scheduled_end_date IS NULL
  OR (scheduled_date IS NOT NULL AND scheduled_end_date >= scheduled_date)
);

-- 2. Column lockdown, continued from 20260721000100: the reschedule RPC below
--    becomes the only possible writer of the window, so every date change
--    necessarily writes its delta. RLS policy audits_update_lead_auditor
--    (20260427120100) keeps row-scoping the columns re-granted here;
--    service_role/postgres (seeds, ops) are untouched.
REVOKE UPDATE ON audits FROM authenticated, anon;
GRANT UPDATE (audit_name, status) ON audits TO authenticated;

-- 3. Reschedule RPC — sole writer of scheduled_date / scheduled_end_date.
--    SECURITY DEFINER (the invoker no longer holds UPDATE on the columns), so
--    the lead-auditor visibility rule is reproduced explicitly: same P0002
--    "not found" for missing and not-owned alike — no existence leak
--    (pattern from 20260721000100).
--    Clearing is allowed and recorded: p_start NULL clears both dates.
CREATE OR REPLACE FUNCTION audit_mode_reschedule_audit(
  p_audit_id uuid,
  p_start    date DEFAULT NULL,
  p_end      date DEFAULT NULL,
  p_reason   text DEFAULT NULL
)
RETURNS audits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user          uuid := auth.uid();
  v_before        audits;
  v_after         audits;
  v_window_before text;
  v_window_after  text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_end IS NOT NULL AND p_start IS NULL THEN
    RAISE EXCEPTION 'An end date requires a start date' USING ERRCODE = '23514';
  END IF;
  IF p_end IS NOT NULL AND p_end < p_start THEN
    RAISE EXCEPTION 'End date must be on or after the start date' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_before FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;
  IF v_before.lead_auditor_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE audits
     SET scheduled_date = p_start, scheduled_end_date = p_end
   WHERE id = p_audit_id
  RETURNING * INTO v_after;

  -- Delta when the window moved, and ALSO when a reason was given for an
  -- unchanged window ("auditee confirmed proposed dates" is provenance the
  -- auditor typed on purpose — dropping it silently would report success for
  -- a record that was never written). A bare Save with unchanged dates and no
  -- reason stays a true no-op. ISO strings, en-dash joined — locale-free;
  -- concat_ws skips NULLs, and end-without-start is impossible (CHECK above).
  IF v_before.scheduled_date IS DISTINCT FROM v_after.scheduled_date
     OR v_before.scheduled_end_date IS DISTINCT FROM v_after.scheduled_end_date
     OR (p_reason IS NOT NULL AND btrim(p_reason) <> '') THEN
    v_window_before := NULLIF(concat_ws(' – ',
      v_before.scheduled_date::text, v_before.scheduled_end_date::text), '');
    v_window_after := NULLIF(concat_ws(' – ',
      v_after.scheduled_date::text, v_after.scheduled_end_date::text), '');

    PERFORM audit_mode_write_delta(
      'AUDIT'::tracked_object_type,
      v_after.id,
      jsonb_build_object(
        'scheduled_window', jsonb_build_object('from', v_window_before, 'to', v_window_after)
      ),
      v_user,
      p_reason
    );
  END IF;

  RETURN v_after;
END;
$$;

GRANT EXECUTE ON FUNCTION audit_mode_reschedule_audit(uuid, date, date, text) TO authenticated;

-- 4. Create RPC gains the optional end date. Body from 20260709000100 with the
--    window validation added; old signature dropped (PostgREST overload
--    ambiguity otherwise).
DROP FUNCTION IF EXISTS audit_mode_create_audit(text, uuid, uuid, audit_type, date, audit_workflow_type, uuid);

CREATE OR REPLACE FUNCTION audit_mode_create_audit(
  p_audit_name          text,
  p_vendor_id           uuid,
  p_protocol_version_id uuid,
  p_audit_type          audit_type,
  p_scheduled_date      date                DEFAULT NULL,
  p_workflow_type       audit_workflow_type DEFAULT 'VENDOR_AUDIT',
  p_site_id             uuid                DEFAULT NULL,
  p_scheduled_end_date  date                DEFAULT NULL
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

  IF p_scheduled_end_date IS NOT NULL AND p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'An end date requires a start date' USING ERRCODE = '23514';
  END IF;
  IF p_scheduled_end_date IS NOT NULL AND p_scheduled_end_date < p_scheduled_date THEN
    RAISE EXCEPTION 'End date must be on or after the start date' USING ERRCODE = '23514';
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
    lead_auditor_id, scheduled_date, scheduled_end_date
  ) VALUES (
    p_vendor_id, p_site_id, v_protocol_id, p_protocol_version_id,
    btrim(p_audit_name), p_audit_type, p_workflow_type, 'IN_PROGRESS', v_stage,
    v_user, p_scheduled_date, p_scheduled_end_date
  )
  RETURNING * INTO v_audit;

  RETURN v_audit;
END;
$$;

GRANT EXECUTE ON FUNCTION audit_mode_create_audit(text, uuid, uuid, audit_type, date, audit_workflow_type, uuid, date) TO authenticated;
