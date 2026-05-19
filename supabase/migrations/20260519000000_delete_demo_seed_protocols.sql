-- =============================================================================
-- Delete demo seed protocols from production.
--
-- The original seed (20260506000200_seed_site_mode_demo.sql) inserted three
-- demo protocols visible to every authenticated user because RLS on site_*
-- tables was permissive. PR #85 (Demo Mode) replaced that path with a
-- client-side fixture store; the prod rows are now obsolete.
--
-- Dependencies, in deletion order:
--   1. site_visits        — FK NO ACTION → explicit delete
--   2. protocol_versions  — FK NO ACTION → explicit delete
--   3. protocols          — main rows; the following cascade automatically:
--        site_participants    (ON DELETE CASCADE)
--        site_team_members    (ON DELETE CASCADE)
--        protocol_visit_templates (ON DELETE CASCADE)
--        documents.protocol_id → SET NULL (documents themselves stay)
--
-- Safety: refuse to delete if any rows in `audits` reference the targets —
-- those would be real audit work and require manual cleanup. The migration
-- raises a clear error in that case so an operator can decide.
--
-- Idempotent: if the seed protocols are already gone, the DO block returns
-- early without touching anything.
-- =============================================================================

DO $$
DECLARE
  target_ids UUID[];
  target_count INTEGER;
  audit_refs INTEGER;
BEGIN
  SELECT array_agg(id) INTO target_ids
  FROM public.protocols
  WHERE study_number IN ('BRIGHTEN-2', 'CARDIAC-7', 'IMMUNE-14');

  target_count := COALESCE(cardinality(target_ids), 0);

  IF target_count = 0 THEN
    RAISE NOTICE 'No demo seed protocols found; nothing to delete.';
    RETURN;
  END IF;

  -- Refuse to nuke if real audit work references these protocols.
  SELECT COUNT(*) INTO audit_refs
  FROM public.audits
  WHERE protocol_id = ANY(target_ids);

  IF audit_refs > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Cannot delete seed protocols: %s audits reference them. Resolve those audits manually before re-running this migration.',
        audit_refs
      );
  END IF;

  -- Explicit deletes for tables whose FK to protocols is NO ACTION.
  DELETE FROM public.site_visits
  WHERE protocol_id = ANY(target_ids);

  DELETE FROM public.protocol_versions
  WHERE protocol_id = ANY(target_ids);

  -- protocols. site_participants, site_team_members, protocol_visit_templates
  -- cascade automatically. documents.protocol_id is set NULL by FK.
  DELETE FROM public.protocols
  WHERE id = ANY(target_ids);

  RAISE NOTICE 'Deleted % demo seed protocols and their dependents.', target_count;
END $$;
