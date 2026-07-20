-- =============================================================================
-- SECURITY FIX (blocker) — enable row-level security on protocol_visit_templates.
--
-- This table (created in 20260507000000_protocol_visit_templates.sql) holds the
-- parsed Schedule of Assessments per protocol — visit names, study days, windows,
-- procedures — and is the source-of-truth the Site Mode calendar
-- (materialize_protocol_visits) and the VEW workspace (visit_execution_get_workspace)
-- both read. Unlike every sibling visit table, it was created WITHOUT RLS, so
-- PostgREST served it to any authenticated account across all tenants: a fresh
-- zero-protocol signup could `GET /rest/v1/protocol_visit_templates?select=*` and
-- read every customer's extracted SoA, or INSERT/UPDATE/DELETE to corrupt another
-- tenant's visit schedule.
--
-- Fix mirrors protocol_visit_coverage (20260626000000) exactly: the RLS-v3 helper
-- user_can_access_protocol(auth.uid(), protocol_id) gates ALL commands for the
-- authenticated role. The ingest pipeline writes as service_role, and the
-- materialize / get_workspace read paths are SECURITY DEFINER — both bypass RLS —
-- so no legitimate read or write path changes. Only the direct cross-tenant
-- PostgREST hole closes.
-- =============================================================================

ALTER TABLE protocol_visit_templates ENABLE ROW LEVEL SECURITY;

-- Owner / org / member access via the RLS-v3 helper (mirrors the other visit tables).
CREATE POLICY "protocol_visit_templates_access"
  ON protocol_visit_templates FOR ALL TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id))
  WITH CHECK (public.user_can_access_protocol(auth.uid(), protocol_id));
