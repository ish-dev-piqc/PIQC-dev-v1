-- =============================================================================
-- protocols.owner_org_id — FK to the resolved org. Replaces free-text
-- `owner_org` matching for RLS purposes.
--
-- The legacy `owner_org` column is KEPT for back-compat — existing app code
-- (B1's createProtocol, B2's ingest auto-create) still writes it. A BEFORE-
-- INSERT trigger auto-resolves `owner_org_id` from `owner_org` so those
-- code paths keep working unchanged. Future PR will drop `owner_org` once
-- consumers all write `owner_org_id` directly.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Column + index
-- ---------------------------------------------------------------------------
ALTER TABLE public.protocols
  ADD COLUMN IF NOT EXISTS owner_org_id UUID REFERENCES public.orgs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS protocols_owner_org_id_idx ON public.protocols(owner_org_id);


-- ---------------------------------------------------------------------------
-- Backfill from owner_org → orgs.name (slug-canonicalised).
-- ---------------------------------------------------------------------------
UPDATE public.protocols p
SET owner_org_id = o.id
FROM public.orgs o
WHERE o.slug = public.slugify(trim(p.owner_org))
  AND p.owner_org IS NOT NULL
  AND trim(p.owner_org) != ''
  AND p.owner_org_id IS NULL;


-- ---------------------------------------------------------------------------
-- Tighten to NOT NULL only if every row is populated. The B1 reversal
-- migration left protocols empty before adding NOT NULL on owner_org, so
-- in production this is a no-op tighten on an empty table. Defensive check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM public.protocols
  WHERE owner_org_id IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Cannot set owner_org_id NOT NULL: %s rows have null values. Either backfill them or remove them before re-running.',
        null_count
      );
  END IF;

  ALTER TABLE public.protocols ALTER COLUMN owner_org_id SET NOT NULL;
END $$;


-- ---------------------------------------------------------------------------
-- Resolver trigger: on INSERT, if owner_org_id is unset but owner_org is
-- populated, look up the org and stamp owner_org_id. Lets existing
-- createProtocol code (which still writes owner_org) keep working.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protocols_resolve_owner_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_org_id IS NULL AND NEW.owner_org IS NOT NULL AND trim(NEW.owner_org) != '' THEN
    SELECT id INTO NEW.owner_org_id
    FROM public.orgs
    WHERE slug = public.slugify(trim(NEW.owner_org));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protocols_resolve_owner_org_id_trg ON public.protocols;
CREATE TRIGGER protocols_resolve_owner_org_id_trg
  BEFORE INSERT ON public.protocols
  FOR EACH ROW
  EXECUTE FUNCTION public.protocols_resolve_owner_org_id();
