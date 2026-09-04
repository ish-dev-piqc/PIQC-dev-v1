-- =============================================================================
-- audit_mode_protocol_document_status — parse status of the audit protocol's
-- document(s), for the Stage-1 "Parsed protocol" card (both workflows).
--
-- Why an RPC: documents / protocol_extracted_items are RLS-scoped (owner, and
-- from 20260912000000 the lead auditor of an audit on the protocol). The card
-- needs counts across EVERY document of the protocol — including another
-- account's pending or ready copy — to say honestly whether PIQC drafts can
-- cite the protocol (any_ready) and whether the caller's own upload is
-- mid-parse (own_pending_document_id, so the card resumes polling after a
-- remount). SECURITY DEFINER with the lead-auditor gate: same skeleton as
-- audit_mode_isa_protocol_bridge_status (20260727000000) minus its workflow
-- guard — both workflows have a Stage 1. That RPC stays (additive rule).
--
-- visible_item_count counts worksheet items across the protocol's ready
-- PROTOCOL documents. That is exactly what the caller can read once
-- 20260912000000 (sotr_audit_lead_read) is applied — guaranteed by filename
-- order at db push, since this file is newer.
--
-- Returns jsonb, mirrored by ProtocolDocumentStatus (src/types/audit/objects.ts):
--   protocol_id, any_ready, own_ready, any_pending, own_pending_document_id,
--   own_failed_error (the caller's latest failed document's error_message —
--   never another account's text), visible_item_count.
--
-- Errors: 42501 unauthenticated; P0002 when the audit is not the caller's.
-- Until applied, PostgREST answers PGRST202 — protocolReadinessApi maps that to
-- { available: false } so the card renders a neutral line, never a false
-- "no protocol".
--
-- Owner: @rv61. Plan: plans/sixonelabs-piqc/audit-protocol-readiness.md
-- =============================================================================
CREATE OR REPLACE FUNCTION audit_mode_protocol_document_status(
  p_audit_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid                     uuid := auth.uid();
  v_protocol_id             uuid;
  v_any_ready               integer;
  v_own_ready               integer;
  v_any_pending             integer;
  v_own_pending_document_id uuid;
  v_own_failed_error        text;
  v_visible_item_count      integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT a.protocol_id INTO v_protocol_id
    FROM audits a
   WHERE a.id = p_audit_id
     AND a.lead_auditor_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) FILTER (WHERE d.status = 'ready')::integer,
         count(*) FILTER (WHERE d.status = 'ready' AND d.user_id = v_uid)::integer,
         count(*) FILTER (WHERE d.status = 'pending')::integer
    INTO v_any_ready, v_own_ready, v_any_pending
    FROM documents d
   WHERE d.protocol_id = v_protocol_id
     AND d.kind = 'PROTOCOL';

  -- The caller's most recent in-flight upload, if any: the card polls it.
  SELECT d.id INTO v_own_pending_document_id
    FROM documents d
   WHERE d.protocol_id = v_protocol_id
     AND d.kind = 'PROTOCOL'
     AND d.status = 'pending'
     AND d.user_id = v_uid
   ORDER BY d.created_at DESC
   LIMIT 1;

  -- The caller's most recent failed upload, if any. A NULL error_message still
  -- counts as a failure — the card must not read "nothing here" for a failed row.
  SELECT COALESCE(d.error_message, 'Parse failed') INTO v_own_failed_error
    FROM documents d
   WHERE d.protocol_id = v_protocol_id
     AND d.kind = 'PROTOCOL'
     AND d.status = 'failed'
     AND d.user_id = v_uid
   ORDER BY d.created_at DESC
   LIMIT 1;

  SELECT count(*)::integer INTO v_visible_item_count
    FROM protocol_extracted_items ei
    JOIN documents d ON d.id = ei.document_id
   WHERE d.protocol_id = v_protocol_id
     AND d.kind = 'PROTOCOL'
     AND d.status = 'ready';

  RETURN jsonb_build_object(
    'protocol_id',             v_protocol_id,
    'any_ready',               COALESCE(v_any_ready, 0),
    'own_ready',               COALESCE(v_own_ready, 0),
    'any_pending',             COALESCE(v_any_pending, 0),
    'own_pending_document_id', v_own_pending_document_id,
    'own_failed_error',        v_own_failed_error,
    'visible_item_count',      COALESCE(v_visible_item_count, 0)
  );
END;
$$;

-- Postgres grants EXECUTE to PUBLIC on creation; revoking from anon alone is a
-- no-op (20260721000000 / 20260911000000 precedent).
REVOKE EXECUTE ON FUNCTION audit_mode_protocol_document_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION audit_mode_protocol_document_status(uuid) TO authenticated, service_role;
