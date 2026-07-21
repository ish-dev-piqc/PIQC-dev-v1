-- =============================================================================
-- SECURITY HARDENING (Fable audit D2-2) — lock seed_audit_mock_data to ops roles.
--
-- seed_audit_mock_data (20260429120000) is SECURITY DEFINER with no caller
-- check and no explicit grants, so under default function privileges any
-- authenticated (or anon) API caller could execute a definer-privileged dev
-- seeder. It is inert in production today only by accident — its INSERTs trip
-- a NOT NULL constraint added later — which means a future schema change could
-- silently re-arm it for any API caller.
--
-- Not dropped: it is the tool that seeds a fresh dev environment's audit
-- fixtures (scripts/smoke-rpcs.sh depends on the seeded UUIDs existing), so it
-- keeps ops value. The fix is privilege-scoping, not deletion: revoke from the
-- API-facing roles; service_role / postgres (ops, seeds, CI) retain access.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION seed_audit_mock_data(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION seed_audit_mock_data(UUID, TEXT) TO service_role;
