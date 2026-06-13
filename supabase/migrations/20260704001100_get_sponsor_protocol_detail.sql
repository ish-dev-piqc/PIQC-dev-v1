-- =============================================================================
-- get_sponsor_protocol_detail — drill-in for Sponsor Mode v2.
--
-- Returns one JSONB with three buckets for the requested protocol:
--   - visit_counts: { scheduled, completed, missed, deviation, overdue }
--     covering the last 30 days
--   - enrollment: { screening, screen_failure, active, completed, withdrawn }
--     all-time counts
--   - recent_deviations: array of { visit_id, date, participant_code,
--     visit_name, deviation_reason } sorted date DESC, max 10
--
-- SECURITY DEFINER + explicit access check (sponsor_relationships has no
-- RLS read policy). The check raises insufficient_privilege if the caller
-- isn't in an org that sponsors this protocol's owner_org.
--
-- JSONB return chosen over multi-result-set so the client gets one
-- round-trip + one adapter call.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_sponsor_protocol_detail(p_protocol_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_authorized BOOLEAN;
  v_visit_counts JSONB;
  v_enrollment JSONB;
  v_recent_deviations JSONB;
  v_thirty_days_ago DATE := (CURRENT_DATE - INTERVAL '30 days')::DATE;
BEGIN
  -- Access check — caller must be in a sponsor-org with a
  -- sponsor_relationships row to this protocol's owner_org.
  SELECT EXISTS (
    SELECT 1
    FROM public.protocols p
    JOIN public.sponsor_relationships sr ON sr.site_org_id = p.owner_org_id
    JOIN public.org_members om
      ON om.org_id = sr.sponsor_org_id
      AND om.user_id = auth.uid()
    WHERE p.id = p_protocol_id
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Not authorized to view this protocol';
  END IF;

  -- Visit counts (last 30 days)
  SELECT jsonb_build_object(
    'scheduled', COUNT(*) FILTER (WHERE status = 'scheduled'),
    'completed', COUNT(*) FILTER (WHERE status = 'completed'),
    'missed',    COUNT(*) FILTER (WHERE status = 'missed'),
    'deviation', COUNT(*) FILTER (WHERE status = 'deviation'),
    'overdue',   COUNT(*) FILTER (WHERE status = 'overdue')
  )
  INTO v_visit_counts
  FROM public.site_visits
  WHERE protocol_id = p_protocol_id
    AND date >= v_thirty_days_ago;

  -- Enrollment by status (all-time)
  SELECT jsonb_build_object(
    'screening',       COUNT(*) FILTER (WHERE status = 'SCREENING'),
    'screen_failure',  COUNT(*) FILTER (WHERE status = 'SCREEN_FAILURE'),
    'active',          COUNT(*) FILTER (WHERE status = 'ACTIVE'),
    'completed',       COUNT(*) FILTER (WHERE status = 'COMPLETED'),
    'withdrawn',       COUNT(*) FILTER (WHERE status = 'WITHDRAWN')
  )
  INTO v_enrollment
  FROM public.site_participants
  WHERE protocol_id = p_protocol_id;

  -- Recent deviations (max 10, newest first)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'visit_id',          sv.id,
        'date',              sv.date,
        'participant_code',  sp.participant_code,
        'visit_name',        sv.visit_name,
        'deviation_reason',  sv.deviation_reason
      ) ORDER BY sv.date DESC
    ),
    '[]'::jsonb
  )
  INTO v_recent_deviations
  FROM public.site_visits sv
  LEFT JOIN public.site_participants sp ON sp.id = sv.participant_id
  WHERE sv.protocol_id = p_protocol_id
    AND sv.status = 'deviation'
  LIMIT 10;

  RETURN jsonb_build_object(
    'visit_counts',       v_visit_counts,
    'enrollment',         v_enrollment,
    'recent_deviations',  v_recent_deviations
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sponsor_protocol_detail(UUID) TO authenticated;
