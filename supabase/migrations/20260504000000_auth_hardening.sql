-- =============================================================================
-- Auth hardening
--   1) Adds profile-completion columns to user_profiles (title, organization,
--      timezone, phone, profile_completed_at).
--   2) Installs an on_auth_user_created trigger that auto-provisions a
--      user_profiles row whenever a new auth.users row is inserted (covers both
--      email/password signups and OAuth — currently Google).
--   3) Backfills user_profiles for any pre-existing auth.users without one.
--
-- The app gates the dashboard on profile_completed_at IS NOT NULL — that's
-- written by the ProfileCompletion screen once the user fills the required
-- fields. The trigger only seeds a stub row; it does not mark completion.
-- =============================================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS title                TEXT,
  ADD COLUMN IF NOT EXISTS organization         TEXT,
  ADD COLUMN IF NOT EXISTS timezone             TEXT,
  ADD COLUMN IF NOT EXISTS phone                TEXT,
  ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;


CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'AUDITOR'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


INSERT INTO public.user_profiles (id, name, role)
SELECT u.id,
       COALESCE(u.raw_user_meta_data->>'full_name', ''),
       'AUDITOR'
FROM auth.users u
LEFT JOIN public.user_profiles p ON p.id = u.id
WHERE p.id IS NULL;
