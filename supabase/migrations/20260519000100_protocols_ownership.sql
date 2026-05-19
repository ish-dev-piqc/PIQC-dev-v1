-- =============================================================================
-- protocols.owner_id + protocols.owner_org — per-user / per-org tenancy.
--
-- v1 model:
--   owner_id  — UUID FK to auth.users; the user who created the protocol
--   owner_org — free-text mirror of user_profiles.organization at creation time
--
-- Rationale (free-text org over a normalised orgs table):
--   For v1, simple substring/equality matching against user_profiles.organization
--   is enough — coordinators on the same site share the same organization
--   string and can see each other's work. Promotion to a real `orgs` table
--   with invites / admin roles is a follow-up (see master plan §9.0a).
--
-- ON DELETE SET NULL on owner_id so deleting an auth user doesn't cascade-
-- delete their protocols. Operational safety.
--
-- Tightening to NOT NULL happens at the end, but only if all rows are
-- populated. Right now `protocols` should be empty (post seed deletion in
-- 20260519000000) so this is a clean migration. If a row somehow exists
-- with a NULL owner, the DO block raises and the migration aborts — better
-- than silently setting NOT NULL with bad data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Columns + indexes
-- ---------------------------------------------------------------------------
ALTER TABLE public.protocols
  ADD COLUMN IF NOT EXISTS owner_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_org TEXT;

CREATE INDEX IF NOT EXISTS protocols_owner_id_idx  ON public.protocols(owner_id);
CREATE INDEX IF NOT EXISTS protocols_owner_org_idx ON public.protocols(owner_org);


-- ---------------------------------------------------------------------------
-- Tighten to NOT NULL (only if every row already has values).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM public.protocols
  WHERE owner_id IS NULL OR owner_org IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Cannot set owner_id/owner_org NOT NULL: %s rows have null values. Backfill them before re-running this migration.',
        null_count
      );
  END IF;

  ALTER TABLE public.protocols ALTER COLUMN owner_id  SET NOT NULL;
  ALTER TABLE public.protocols ALTER COLUMN owner_org SET NOT NULL;
END $$;
