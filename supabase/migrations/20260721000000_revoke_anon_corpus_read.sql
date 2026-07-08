-- =============================================================================
-- Revoke anon read access to the protocol corpus (documents / chunks /
-- hybrid_search) — closes the anon read-all leak (post-#449 audit report,
-- vulnerability #1; originally deferred out of PR #441).
--
-- 20260417223946 added `USING (true)` SELECT policies TO anon on documents and
-- chunks because "the dashboard does not require authentication" — true of the
-- April prototype, false ever since auth shipped. The anon key ships inside the
-- public frontend bundle, so anyone could read every uploaded protocol document
-- and chunk (and run hybrid_search over them) without an account.
--
-- What this migration does NOT need to touch: the authenticated side.
-- 20260430130000 already replaced the authenticated `USING (true)` policies
-- with owner-scoped ones (documents: user_id = auth.uid(); chunks: EXISTS join
-- through documents). Those remain the live policies and are correct.
--
-- Verified safe to revoke (2026-07-07):
--   - All edge functions (dashboard-chat, ingest lane) call with the service
--     role key — unaffected.
--   - Demo mode (DemoAskPanel) renders from local fixtures; live chat is
--     intentionally off in demo.
--   - Every client consumer of documents/chunks/hybrid_search (KnowledgeBase,
--     DashboardChat, orgsApi, auditCreationApi, realSiteRepo) is behind login,
--     so requests carry a user JWT → authenticated role, not anon.
--   - hybrid_search is SECURITY INVOKER, so chunk/document RLS already applies
--     inside it; the EXECUTE revoke below is defense in depth (clean permission
--     error instead of an empty result set, and no wasted embedding compute).
--
-- The table-level REVOKEs make anon denial a hard `permission denied` rather
-- than an RLS-empty 200 — unambiguous for the smoke check in
-- scripts/smoke-rpcs.sh, and a future accidental anon policy can't silently
-- reopen the leak.
--
-- Owner: @rv61.
-- =============================================================================

DROP POLICY IF EXISTS "Anon users can read documents" ON documents;
DROP POLICY IF EXISTS "Anon users can read chunks" ON chunks;

REVOKE SELECT ON documents FROM anon;
REVOKE SELECT ON chunks FROM anon;

-- Single live overload (every prior signature is DROPped by 20260423230000 /
-- 20260423240000 / 20260423250000). Postgres grants EXECUTE to PUBLIC on
-- creation, so revoking from anon alone is a no-op — anon keeps access through
-- PUBLIC. Revoke from PUBLIC and grant back only the roles that need it
-- (verified locally with has_function_privilege).
REVOKE EXECUTE ON FUNCTION public.hybrid_search(float8[], text, integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hybrid_search(float8[], text, integer, uuid[]) TO authenticated, service_role;
