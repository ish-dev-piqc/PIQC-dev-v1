-- 20260911000000_definer_helper_grants.sql
--
-- Security hygiene (follow-up to 20260910000000 / #601): revoke anon EXECUTE
-- on the SECURITY DEFINER helper functions that carry no auth.uid() gate in
-- their own body and were never named in a REVOKE.
--
-- Each of these was created with Postgres's default EXECUTE grant to PUBLIC,
-- and Supabase's default privileges add an explicit grant to anon as well.
-- Their defining migrations granted `TO authenticated` (or nothing) but never
-- revoked PUBLIC/anon, so every one of them is callable through PostgREST with
-- the project's public key. Observed on the hosted project 2026-09-03: all
-- nine executed for the anon role with null arguments (HTTP 200; the orphan
-- pair ran up to its org-admin gate and raised P0001).
--
-- The callers that must keep EXECUTE run as one of two roles:
--   authenticated — RLS policies (all `TO authenticated`), SECURITY INVOKER
--                   RPCs, and the frontend's supabase-js client
--   service_role  — send-daily-digest and dashboard-chat call
--                   user_can_access_protocol with the service key
-- Callers that are themselves SECURITY DEFINER (org-event triggers,
-- audit_mode_create/update_protocol_risk, user_can_access_deliverable_engine)
-- execute as the owner and need no grant. service_role is granted on every
-- function for parity with the hybrid_search precedent (20260721000000) —
-- it already held that grant by default, so this widens nothing.
--
-- count_orphan_chat_attachments / delete_orphan_chat_attachments gate on
-- current_user_is_any_org_admin() in their bodies; for those two the revoke
-- is defense in depth only.
--
-- Grants only: no CREATE OR REPLACE, no body changes, every applied
-- definition stays untouched. Signatures are pinned to the applied
-- definitions so a future overload never inherits this by name. Every
-- function has exactly one overload as of this migration.
--
-- Not closed here (needs CREATE OR REPLACE of applied INVOKER callers):
-- any logged-in user can still call the seven un-gated helpers with
-- arbitrary ids. See plans/sixonelabs-piqc/definer-helper-grants.md.

-- Protocol access (20260618000400, re-created 20260618000800)
REVOKE EXECUTE ON FUNCTION public.user_can_access_protocol(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_protocol(uuid, uuid)
  TO authenticated, service_role;

-- Deliverable engine access (20260720000400)
REVOKE EXECUTE ON FUNCTION public.user_can_access_deliverable_engine(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_deliverable_engine(uuid, uuid)
  TO authenticated, service_role;

-- Org entitlement lookup (20260720000300)
REVOKE EXECUTE ON FUNCTION public.org_has_entitlement(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_has_entitlement(uuid, text)
  TO authenticated, service_role;

-- Protocol → owner org (20260704000000)
REVOKE EXECUTE ON FUNCTION public.protocol_owner_org_id(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.protocol_owner_org_id(uuid)
  TO authenticated, service_role;

-- Audit Mode source-link check (20260515010000)
REVOKE EXECUTE ON FUNCTION public.audit_mode_extracted_item_matches_protocol(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_mode_extracted_item_matches_protocol(uuid, uuid)
  TO authenticated, service_role;

-- SOTR review snapshot builder (20260508040100)
REVOKE EXECUTE ON FUNCTION public._sotr_build_review_snapshot(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._sotr_build_review_snapshot(uuid[])
  TO authenticated, service_role;

-- SOTR sources JSON builder (20260508020000)
REVOKE EXECUTE ON FUNCTION public._sotr_build_sources_json(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._sotr_build_sources_json(uuid)
  TO authenticated, service_role;

-- Chat-attachment orphan sweep, org-admin gated in the body (20260704000100)
REVOKE EXECUTE ON FUNCTION public.count_orphan_chat_attachments()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_orphan_chat_attachments()
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.delete_orphan_chat_attachments()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_orphan_chat_attachments()
  TO authenticated, service_role;
