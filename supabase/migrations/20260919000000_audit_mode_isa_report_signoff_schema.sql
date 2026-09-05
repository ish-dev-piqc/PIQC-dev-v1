-- =============================================================================
-- Audit Mode — ISA report sign-off + export latch schema (isa-review-export)
--
-- Four additive columns on isa_report_draft_objects, the ISA counterpart of
-- report_draft_objects' final_signed_off_* / exported_at (20260501000000)
-- and readiness_fingerprint (20260730000000):
--
--   readiness_fingerprint — sealed at sign-off: md5 over everything the
--                           exported report renders from stored state (the
--                           four prose columns, the verdict and its nuance,
--                           the response-clause parameters, a digest of the
--                           audit's findings and of its positive notes).
--                           Recomputed at every export boundary; a mismatch
--                           means the report changed since it was reviewed.
--   final_signed_off_at/by — the latch. Doctrine (20260730000000): in-PIQC
--                           sign-off is a readiness-to-export latch at the
--                           draft boundary, never a GxP attestation.
--   exported_at           — when the signed-off version last left PIQC.
--                           Cleared when a re-sign seals a new version, so
--                           "Exported" never describes content that changed.
--
-- One latch, not two: the vendor report approves at Stage 7 and signs off at
-- Stage 8 because its classified entries live in another table. The ISA
-- report's precondition is the site verdict (already a column, already the
-- Stage 6 export gate); sign-off at Review & export is the single latch. No
-- approval_status column.
--
-- Nothing here changes an applied function; 20260919000100 adds NEW
-- functions only. RLS and the touch trigger on the table are unchanged —
-- the CAS in the sign-off RPC relies on that trigger. Owner: @rv61.
-- =============================================================================

ALTER TABLE isa_report_draft_objects
  ADD COLUMN readiness_fingerprint TEXT,
  ADD COLUMN final_signed_off_by   UUID REFERENCES auth.users(id),
  ADD COLUMN final_signed_off_at   TIMESTAMPTZ,
  ADD COLUMN exported_at           TIMESTAMPTZ;
