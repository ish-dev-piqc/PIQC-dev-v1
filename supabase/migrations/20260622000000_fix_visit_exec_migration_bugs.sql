-- =============================================================================
-- Forward-fix (append-only) for two bugs in already-merged migrations.
--
-- Migrations are append-only, so rather than edit the originals we re-assert
-- the corrected objects here. Both are idempotent — the shared dev DB already
-- has the corrected versions from this session; this records the fix as a
-- proper new migration so a clean apply (and CI) stays consistent.
--
-- Bug 1 — 20260618000200_protocol_guests.sql:
--   protocol_guests_active_count_idx had `WHERE ... expires_at > NOW()`.
--   Index predicates must be IMMUTABLE; NOW() is not → SQLSTATE 42P17.
--   Recreate without the volatile clause (partial on accepted_at; the
--   not-expired filter is applied at query time in the entitlement check).
--
-- Bug 2 — 20260615000500_visit_execution_persist_rpc.sql:
--   _vew_fingerprint called bare digest(); pgcrypto lives in the `extensions`
--   schema and the migration runner's search_path excludes it → 42883.
--   Qualify as extensions.digest (output identical → fingerprints unchanged).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Bug 1: drop + recreate the partial index without NOW().
DROP INDEX IF EXISTS public.protocol_guests_active_count_idx;
CREATE INDEX IF NOT EXISTS protocol_guests_active_count_idx
  ON public.protocol_guests(protocol_id, is_paid_seat, expires_at)
  WHERE accepted_at IS NOT NULL;

-- Bug 2: schema-qualify pgcrypto's digest() in the fingerprint helper.
CREATE OR REPLACE FUNCTION _vew_fingerprint(
  p_visit_template_id UUID,
  p_derived_text TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT encode(
    extensions.digest(
      p_visit_template_id::text || '|' || _vew_normalize_derived_text(p_derived_text),
      'sha256'
    ),
    'hex'
  );
$$;
