-- =============================================================================
-- Visit Execution Workspace — Sprint 3.5a (3 of 5):
-- visit_completeness_signals table.
--
-- Per parser-integration.md §8.3.
--
-- One row per detected gap — a requirement the missing-requirement detection
-- second-pass LLM thinks the protocol mandates for this visit but the first-
-- pass extract didn't surface as a procedure. The signal lives here until a
-- human resolves it ('added_as_requirement' or 'dismissed_not_real').
--
-- Populated by Sprint 3.5b's ingest pipeline. Sprint 3.5a creates the table
-- empty; the RPC surfaces an empty array for every visit until 3.5b lands.
--
-- RLS mirrors visit_requirements' policy: read/write if the caller owns the
-- protocol (direct owner_id) or is a member of the protocol's owning org.
-- =============================================================================

CREATE TABLE visit_completeness_signals (
  id                     UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_template_id      UUID                    NOT NULL REFERENCES protocol_visit_templates(id) ON DELETE CASCADE,

  -- The verbatim gap statement from the second-pass LLM (e.g. "Body weight
  -- measurement appears required at this visit but was not detected").
  gap_text               TEXT                    NOT NULL,

  -- Where in the protocol the LLM saw the evidence of this requirement.
  -- Both nullable — the LLM may flag a gap without precise citation.
  source_section         TEXT,
  source_page            INTEGER,

  -- LLM's confidence that this gap is real. Drives UI priority sorting in
  -- future Sprint 4 work.
  detection_confidence   confidence_state        NOT NULL,
  -- One-sentence reasoning from the LLM. Counts-only logging applies — keep
  -- text bounded (DB will accept any length; UI truncates).
  detection_reason       TEXT,

  detected_at            TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

  -- Resolution state. 'pending' until a human acts; never auto-resolved.
  resolution             visit_signal_resolution NOT NULL DEFAULT 'pending',
  acknowledged_by        UUID                    REFERENCES auth.users(id),
  acknowledged_at        TIMESTAMPTZ,

  -- Idempotency guard: if the same gap_text is detected again on re-ingest,
  -- the upsert path (Sprint 3.5b) keys on this pair. Prevents duplicate
  -- signals across re-ingests of the same protocol version.
  UNIQUE (visit_template_id, gap_text)
);


-- Most common query: all pending signals for one visit.
CREATE INDEX visit_completeness_signals_visit_idx
  ON visit_completeness_signals(visit_template_id);

CREATE INDEX visit_completeness_signals_visit_pending_idx
  ON visit_completeness_signals(visit_template_id)
  WHERE resolution = 'pending';


ALTER TABLE visit_completeness_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visit_completeness_signals_owner"
  ON visit_completeness_signals FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM protocol_visit_templates t
        JOIN protocols p ON p.id = t.protocol_id
       WHERE t.id = visit_completeness_signals.visit_template_id
         AND (
           p.owner_id = auth.uid()
           OR p.owner_org_id IN (
             SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
           )
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM protocol_visit_templates t
        JOIN protocols p ON p.id = t.protocol_id
       WHERE t.id = visit_completeness_signals.visit_template_id
         AND (
           p.owner_id = auth.uid()
           OR p.owner_org_id IN (
             SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
           )
         )
    )
  );


COMMENT ON TABLE visit_completeness_signals IS
  'Detected gaps — requirements the LLM thinks the protocol mandates for a '
  'visit but the first-pass extract missed. PIQC never auto-promotes these '
  'to visit_requirements; a human acts via resolution column.';

COMMENT ON COLUMN visit_completeness_signals.gap_text IS
  'Verbatim gap statement from the second-pass missing-requirement detection LLM.';

COMMENT ON COLUMN visit_completeness_signals.resolution IS
  'pending → newly detected. added_as_requirement → human promoted to a '
  'visit_requirements row. dismissed_not_real → human rejected the signal.';
