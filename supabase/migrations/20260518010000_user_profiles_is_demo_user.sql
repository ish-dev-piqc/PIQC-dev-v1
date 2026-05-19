-- =============================================================================
-- user_profiles.is_demo_user — server-gated flag that controls whether the
-- in-app Demo Mode toggle is even visible to a user. Without this flag set,
-- the toggle UI is hidden and demoActive auto-falsifies. Granted only via
-- direct SQL by admins (no in-app surface for setting it).
--
-- Security: the existing user_profiles_update_self RLS policy lets a user
-- UPDATE their own row, which would allow self-promotion to is_demo_user =
-- TRUE. The protect_is_demo_user trigger below blocks that — only the
-- service_role / postgres / supabase_admin roles (i.e. direct SQL or service
-- key) can change the value. Authenticated user updates that try to flip
-- the column are silently reverted.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_demo_user BOOLEAN NOT NULL DEFAULT FALSE;


-- ---------------------------------------------------------------------------
-- Trigger: prevent authenticated users from modifying is_demo_user on their
-- own row. Service-side updates (admin SQL, service-role API calls) pass
-- through unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_is_demo_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_demo_user IS DISTINCT FROM OLD.is_demo_user
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
  THEN
    NEW.is_demo_user := OLD.is_demo_user;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_is_demo_user_trg ON public.user_profiles;
CREATE TRIGGER protect_is_demo_user_trg
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_is_demo_user();
