-- 20260910000000_visit_execution_persist_grants.sql
--
-- Security fix: lock visit_execution_persist_parsed_workspace to service_role.
--
-- The function is SECURITY DEFINER with no ownership check in its body
-- (20260615000500, re-created 20260714000000), and neither migration touched
-- its grants — so it kept Postgres's default EXECUTE grant to PUBLIC. Any
-- caller holding the project's public key could invoke it and write
-- visit_requirements, child rules and completeness signals into any protocol.
-- Confirmed reachable from the anon role on the hosted project on 2026-09-03.
--
-- Its only caller is the ingest pipeline
-- (supabase/functions/_shared/ingestPipeline.ts → persistVisitExecutionWorkspaces),
-- and every edge function that runs the pipeline (ingest, ingest-status,
-- ingest-recover, reducto-webhook) builds its client with the service-role key.
-- No user role needs EXECUTE, so no ownership gate is added to the body:
-- grants only, no CREATE OR REPLACE, the applied definition stays untouched.
--
-- The signature is pinned so a future overload never inherits this by name.

REVOKE EXECUTE ON FUNCTION public.visit_execution_persist_parsed_workspace(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.visit_execution_persist_parsed_workspace(uuid, jsonb)
  TO service_role;
