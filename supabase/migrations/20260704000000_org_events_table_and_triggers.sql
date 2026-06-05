-- =============================================================================
-- org_events — append-only audit log of org / protocol membership changes.
--
-- Visible to org admins. Populated exclusively by triggers on the canonical
-- tables; no INSERT / UPDATE / DELETE policy is granted to clients so the
-- log can't be tampered with through PostgREST.
--
-- Event types covered:
--   org_member_added           (org_members INSERT)
--   org_member_removed         (org_members DELETE)
--   org_member_role_changed    (org_members UPDATE of role)
--   protocol_member_added      (protocol_members INSERT)
--   protocol_member_removed    (protocol_members DELETE)
--   protocol_member_role_changed (protocol_members UPDATE of role)
--   invite_created             (org_invites INSERT)
--   invite_cancelled           (org_invites DELETE while used_at IS NULL)
--   access_request_approved    (protocol_access_requests UPDATE pending->approved)
--
-- 'org_member_added' subsumes invite-accept since accept_org_invite ends
-- with an org_members INSERT. describe() in the adapter differentiates
-- "joined" vs "added" by checking actor_user_id == target_user_id.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.org_events (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID         NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  event_type          TEXT         NOT NULL,
  actor_user_id       UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id      UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  target_protocol_id  UUID         REFERENCES public.protocols(id) ON DELETE SET NULL,
  payload             JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS org_events_org_id_created_at_idx
  ON public.org_events (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS org_events_target_user_idx
  ON public.org_events (target_user_id)
  WHERE target_user_id IS NOT NULL;

ALTER TABLE public.org_events ENABLE ROW LEVEL SECURITY;

-- SELECT — org admins only. INSERT / UPDATE / DELETE — no policy
-- (rows arrive exclusively through trigger code running with table-owner
-- privileges).
DROP POLICY IF EXISTS org_events_admin_select ON public.org_events;
CREATE POLICY org_events_admin_select
  ON public.org_events
  FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_admin_org_ids()));


-- ---------------------------------------------------------------------------
-- Shared helper — find the owning org_id of a protocol via protocol_org_access.
-- SECURITY DEFINER + STABLE so triggers can call it without RLS getting in
-- the way. Returns NULL if the protocol has no 'owner' row (shouldn't happen
-- since the first-owner trigger guarantees one, but be safe).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protocol_owner_org_id(p_protocol_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id
  FROM protocol_org_access
  WHERE protocol_id = p_protocol_id
    AND role = 'owner'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.protocol_owner_org_id(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- Trigger function: org_members → org_events
-- Fires AFTER INSERT / UPDATE OF role / DELETE on org_members.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_org_member_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO org_events (org_id, event_type, actor_user_id, target_user_id, payload)
    VALUES (
      NEW.org_id,
      'org_member_added',
      auth.uid(),
      NEW.user_id,
      jsonb_build_object('role', NEW.role)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      INSERT INTO org_events (org_id, event_type, actor_user_id, target_user_id, payload)
      VALUES (
        NEW.org_id,
        'org_member_role_changed',
        auth.uid(),
        NEW.user_id,
        jsonb_build_object('from', OLD.role, 'to', NEW.role)
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO org_events (org_id, event_type, actor_user_id, target_user_id, payload)
    VALUES (
      OLD.org_id,
      'org_member_removed',
      auth.uid(),
      OLD.user_id,
      jsonb_build_object('prev_role', OLD.role)
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS org_members_audit ON public.org_members;
CREATE TRIGGER org_members_audit
  AFTER INSERT OR UPDATE OF role OR DELETE ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.log_org_member_event();


-- ---------------------------------------------------------------------------
-- Trigger function: protocol_members → org_events
-- The org_id is resolved from protocol_org_access. If no owner org is
-- found (edge case for legacy data) the event is skipped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_protocol_member_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_org_id := protocol_owner_org_id(NEW.protocol_id);
    IF v_org_id IS NULL THEN RETURN NEW; END IF;
    INSERT INTO org_events (org_id, event_type, actor_user_id, target_user_id, target_protocol_id, payload)
    VALUES (
      v_org_id,
      'protocol_member_added',
      auth.uid(),
      NEW.user_id,
      NEW.protocol_id,
      jsonb_build_object('role', NEW.role)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      v_org_id := protocol_owner_org_id(NEW.protocol_id);
      IF v_org_id IS NULL THEN RETURN NEW; END IF;
      INSERT INTO org_events (org_id, event_type, actor_user_id, target_user_id, target_protocol_id, payload)
      VALUES (
        v_org_id,
        'protocol_member_role_changed',
        auth.uid(),
        NEW.user_id,
        NEW.protocol_id,
        jsonb_build_object('from', OLD.role, 'to', NEW.role)
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_org_id := protocol_owner_org_id(OLD.protocol_id);
    IF v_org_id IS NULL THEN RETURN OLD; END IF;
    INSERT INTO org_events (org_id, event_type, actor_user_id, target_user_id, target_protocol_id, payload)
    VALUES (
      v_org_id,
      'protocol_member_removed',
      auth.uid(),
      OLD.user_id,
      OLD.protocol_id,
      jsonb_build_object('prev_role', OLD.role)
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS protocol_members_audit ON public.protocol_members;
CREATE TRIGGER protocol_members_audit
  AFTER INSERT OR UPDATE OF role OR DELETE ON public.protocol_members
  FOR EACH ROW EXECUTE FUNCTION public.log_protocol_member_event();


-- ---------------------------------------------------------------------------
-- Trigger function: org_invites → org_events
-- INSERT  → invite_created
-- DELETE  → invite_cancelled (only when used_at IS NULL — we don't log the
--           cascade-delete that follows successful invite usage, since the
--           org_members INSERT already covers "the new member joined")
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_org_invite_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO org_events (org_id, event_type, actor_user_id, payload)
    VALUES (
      NEW.org_id,
      'invite_created',
      COALESCE(NEW.invited_by, auth.uid()),
      jsonb_build_object('invite_id', NEW.id, 'email', NEW.email, 'role', NEW.role)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Only log explicit cancellations (never-used invites). Invites that
    -- get deleted because they were accepted are implied by the
    -- org_member_added event.
    IF OLD.used_at IS NULL THEN
      INSERT INTO org_events (org_id, event_type, actor_user_id, payload)
      VALUES (
        OLD.org_id,
        'invite_cancelled',
        auth.uid(),
        jsonb_build_object('invite_id', OLD.id, 'email', OLD.email)
      );
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS org_invites_audit ON public.org_invites;
CREATE TRIGGER org_invites_audit
  AFTER INSERT OR DELETE ON public.org_invites
  FOR EACH ROW EXECUTE FUNCTION public.log_org_invite_event();


-- ---------------------------------------------------------------------------
-- Trigger function: protocol_access_requests → org_events
-- Fires only on the pending → approved transition. Denied / withdrawn
-- transitions aren't logged in v1 — they're noise without the
-- corresponding "added" side-effect.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_access_request_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
    v_org_id := protocol_owner_org_id(NEW.protocol_id);
    IF v_org_id IS NULL THEN RETURN NEW; END IF;
    INSERT INTO org_events (org_id, event_type, actor_user_id, target_user_id, target_protocol_id, payload)
    VALUES (
      v_org_id,
      'access_request_approved',
      COALESCE(NEW.resolved_by, auth.uid()),
      NEW.user_id,
      NEW.protocol_id,
      jsonb_build_object('request_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protocol_access_requests_audit ON public.protocol_access_requests;
CREATE TRIGGER protocol_access_requests_audit
  AFTER UPDATE OF status ON public.protocol_access_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_access_request_event();
