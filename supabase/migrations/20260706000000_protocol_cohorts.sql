-- =============================================================================
-- protocol_cohorts — the authoritative per-protocol study cohort/arm list.
--
-- A branched study (FIH SAD/MAD, dose-escalation, expansion, food-effect, …)
-- defines its cohorts in the synopsis / cohort-definition PROSE — the same body
-- text the Ask (RAG) tab reads. The ingest pipeline now extracts that list
-- structurally (label + per-cohort dose + a citation) and writes it here, so
-- Visit Prep can surface every cohort (not just the ones an SoA "[X only]"
-- marker happened to mention). Per-visit cohort SCOPE stays on
-- protocol_visit_templates.applies_to (set by the grid parse from table
-- headings); THIS table is the authoritative list the cohort selector is driven
-- from + what the RAG↔structured reconciliation check counts against.
--
-- Fully additive: a protocol with no extracted cohorts → zero rows here → no
-- cohort UI (identical to today). Single-schedule protocols are unaffected.
--
-- Writes come from the ingest Edge Function (service role → RLS bypassed); the
-- only client access is SELECT under RLS (Visit Prep reads it directly), gated
-- by protocol membership via the existing user_can_access_protocol() helper —
-- the same gate protocol_documents uses. Append-only migration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.protocol_cohorts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id   UUID        NOT NULL REFERENCES public.protocols(id) ON DELETE CASCADE,
  -- Canonical cohort label as it scopes visits (matches protocol_visit_templates.applies_to
  -- entries), e.g. 'S1', 'MAD', 'Cohort B'. UNIQUE per protocol so re-ingest upserts.
  label         TEXT        NOT NULL,
  -- Per-cohort dose / regimen prose ("BLKR-201 50 mg IV q2w"), null if not stated.
  dose_regimen  TEXT,
  -- Free-text cohort description (population / purpose), null if not stated.
  description   TEXT,
  -- Display order (extraction order = protocol's own cohort order). 0-based.
  ordinal       INTEGER     NOT NULL DEFAULT 0,
  -- Evidence: the PDF page + a short verbatim quote the cohort was read from.
  -- The extraction is evidence-gated — a cohort with no citation is flagged
  -- upstream, never invented — so these support the "no false confidence" gate.
  source_page   INTEGER,
  source_quote  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (protocol_id, label)
);

CREATE INDEX IF NOT EXISTS protocol_cohorts_protocol_idx
  ON public.protocol_cohorts (protocol_id);

ALTER TABLE public.protocol_cohorts ENABLE ROW LEVEL SECURITY;

-- SELECT: any member who can access the parent protocol. Writes are service-role
-- only (ingest), so no authenticated INSERT/UPDATE/DELETE policy is needed.
DROP POLICY IF EXISTS protocol_cohorts_select ON public.protocol_cohorts;
CREATE POLICY protocol_cohorts_select
  ON public.protocol_cohorts
  FOR SELECT
  TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id));

COMMENT ON TABLE public.protocol_cohorts IS
  'Authoritative per-protocol study cohort/arm list (label + dose + citation), '
  'extracted from the protocol body by ingest. Drives the Visit Prep cohort '
  'selector and the RAG↔structured cohort reconciliation. Empty = non-cohort '
  'protocol (no cohort UI). Per-visit scope lives on '
  'protocol_visit_templates.applies_to.';
