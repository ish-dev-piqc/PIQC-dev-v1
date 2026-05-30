-- =============================================================================
-- protocol_member_first_owner_trigger — when a protocol is inserted, auto-add
-- the inserting user (NEW.owner_id) to protocol_members as 'coordinator'.
--
-- Without this trigger, the moment RLS v3 kicks in (previous migration),
-- the creator of a protocol could not see their own protocol data — because
-- protocol_members would be empty for that protocol, user_can_access_protocol
-- would return FALSE, and every site_* SELECT would return zero rows.
--
-- Idempotent: ON CONFLICT DO NOTHING handles the (extremely rare) case where
-- backfill or another mechanism already inserted a row. SECURITY DEFINER
-- because the inserting user has no protocol_members row yet, so the
-- protocol_members_coordinator_modify INSERT policy would block them.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.protocol_add_owner_as_coordinator()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO public.protocol_members (protocol_id, user_id, role, added_by)
    VALUES (NEW.id, NEW.owner_id, 'coordinator', NEW.owner_id)
    ON CONFLICT (protocol_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protocol_add_owner_as_coordinator_trg ON public.protocols;
CREATE TRIGGER protocol_add_owner_as_coordinator_trg
  AFTER INSERT ON public.protocols
  FOR EACH ROW
  EXECUTE FUNCTION public.protocol_add_owner_as_coordinator();
