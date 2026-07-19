-- =============================================================================
-- protocol_divergences — narrative↔grid divergence records (the flagship).
--
-- Narrative recovery (soaGridParser.enrichScheduleFromLlm) gives PIQC a second,
-- independent reading of the same protocol. Where the two readings DISAGREE,
-- ingest writes one row here (detectNarrativeGridDivergences — deterministic
-- comparators only; both readings derive from the uploaded document, so this is
-- litmus-clean by construction: the protocol cited against itself, never an
-- external norm). PIQC never adjudicates which reading is right: the record
-- carries both readings + a what-was-compared detail, and the HUMAN
-- dispositions it. The user clarifies with the sponsor; PIQC never contacts
-- anyone.
--
-- Lifecycle (closability is a correctness requirement — an unclosable
-- discrepancy becomes permanent noise): open → raised_with_sponsor →
-- resolved | dismissed. A note is REQUIRED to resolve/dismiss. Every transition
-- APPENDS to `dispositions`; nothing erases — an audit can always see that the
-- divergence existed and how it was dispositioned. Reopen = another transition.
--
-- Writes: ingest (service role) upserts on (protocol_id, locus_key) with
-- ignoreDuplicates, so a re-ingest never clobbers an existing record's
-- lifecycle. Status changes go through protocol_divergence_set_status
-- (SECURITY DEFINER, access-gated on the first lines) — no client table-write
-- policy, same posture as protocol_cohorts.
--
-- TS mirror: src/types/divergence/index.ts.
-- Design: plans/fable/narrative-first-worksheet-spec.md §5.5.
-- Append-only migration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.protocol_divergences (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id      UUID        NOT NULL REFERENCES public.protocols(id) ON DELETE CASCADE,
  -- The document whose ingest first detected this divergence (kept across
  -- re-ingests via ignoreDuplicates; an amendment's ingest appends new loci).
  document_id      UUID        REFERENCES public.documents(id) ON DELETE SET NULL,
  class            TEXT        NOT NULL CHECK (class IN ('window_mismatch', 'presence', 'cohort_scope')),
  -- Stable per-protocol locus identity (w:<visit> / p:<visit>:<label> /
  -- c:<note-slug>) — the upsert key across re-ingests.
  locus_key        TEXT        NOT NULL,
  visit_name       TEXT,
  procedure_label  TEXT,
  -- The two readings, each { source, quote, verbatim, section, page }.
  -- verbatim=false marks an extraction-recorded value honestly labeled as such
  -- (the extract stores integers for windows, not the surrounding prose).
  reading_a        JSONB       NOT NULL,  -- the SoA grid reading
  reading_b        JSONB       NOT NULL,  -- the narrative reading
  -- What was compared, stated without a verdict.
  detail           TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'raised_with_sponsor', 'resolved', 'dismissed')),
  -- Append-only [{ status, note, actor, at }]. Resolution annotates, never erases.
  dispositions     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (protocol_id, locus_key)
);

CREATE INDEX IF NOT EXISTS protocol_divergences_protocol_idx
  ON public.protocol_divergences (protocol_id);

ALTER TABLE public.protocol_divergences ENABLE ROW LEVEL SECURITY;

-- SELECT: any member who can access the parent protocol (same gate as
-- protocol_cohorts). Writes are service-role (ingest) + the DEFINER RPC below;
-- no authenticated INSERT/UPDATE/DELETE policy.
DROP POLICY IF EXISTS protocol_divergences_select ON public.protocol_divergences;
CREATE POLICY protocol_divergences_select
  ON public.protocol_divergences
  FOR SELECT
  TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id));

-- ---------------------------------------------------------------------------
-- protocol_divergence_set_status — the ONLY client write path.
-- SECURITY DEFINER with the access gate up front (house pattern for gated
-- writes). Appends the disposition; never rewrites history. v1 standing: any
-- user with access to the protocol may transition any status (the founder may
-- later tighten resolve/dismiss to a reviewer role — open decision, spec §9.1).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protocol_divergence_set_status(
  p_divergence_id UUID,
  p_status        TEXT,
  p_note          TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_protocol_id UUID;
  v_row         public.protocol_divergences%ROWTYPE;
BEGIN
  SELECT protocol_id INTO v_protocol_id
    FROM public.protocol_divergences
   WHERE id = p_divergence_id;
  IF v_protocol_id IS NULL
     OR NOT public.user_can_access_protocol(auth.uid(), v_protocol_id) THEN
    RAISE EXCEPTION 'divergence not found or access denied';
  END IF;

  IF p_status NOT IN ('open', 'raised_with_sponsor', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'invalid divergence status: %', p_status;
  END IF;
  -- Closability with accountability: closing states require a human note.
  IF p_status IN ('resolved', 'dismissed') AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'a note is required to mark a divergence %', p_status;
  END IF;

  UPDATE public.protocol_divergences
     SET status = p_status,
         dispositions = dispositions || jsonb_build_array(jsonb_build_object(
           'status', p_status,
           'note',   NULLIF(btrim(COALESCE(p_note, '')), ''),
           'actor',  auth.uid(),
           'at',     NOW()
         ))
   WHERE id = p_divergence_id
   RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.protocol_divergence_set_status(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON TABLE public.protocol_divergences IS
  'Narrative↔SoA-grid divergence records: places where the protocol''s two '
  'readings disagree. Both readings + a what-was-compared detail; human '
  'dispositions via protocol_divergence_set_status (append-only trail). '
  'Written by ingest; never adjudicated by PIQC.';
