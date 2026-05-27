-- =============================================================================
-- Visit Execution Workspace — Sprint 3.5a (2 of 5):
-- visit_signal_resolution enum.
--
-- Per parser-integration.md §8.2. Tracks how the human-in-the-loop resolved a
-- completeness signal flagged by the second-pass missing-requirement detection
-- LLM:
--
--   pending               — newly detected, no human decision yet
--   added_as_requirement  — coordinator agreed the gap is real and promoted
--                           it to a visit_requirements row
--   dismissed_not_real    — coordinator reviewed and decided this is NOT a
--                           missing requirement (e.g. the LLM mis-identified
--                           it; or it's covered by another row already)
--
-- Used as the resolution column on visit_completeness_signals (migration 3 of
-- this batch).
--
-- NOTE on completeness principle: PIQC NEVER auto-adds detected gaps as real
-- requirements. The signal sits at 'pending' until a human acts. Promotion to
-- a visit_requirements row is an explicit human action — preserves the
-- expert-oversight guarantee per founder + Babaeipour 2026 evidence base.
-- =============================================================================

CREATE TYPE visit_signal_resolution AS ENUM (
  'pending',
  'added_as_requirement',
  'dismissed_not_real'
);


COMMENT ON TYPE visit_signal_resolution IS
  'Resolution state for a visit_completeness_signals row. Defaults to pending. '
  'Only a human action transitions to added_as_requirement or dismissed_not_real — '
  'PIQC never auto-resolves gaps.';
