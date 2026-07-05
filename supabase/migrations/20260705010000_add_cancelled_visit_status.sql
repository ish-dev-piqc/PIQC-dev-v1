-- =============================================================================
-- Site Mode — add 'cancelled' to site_visit_status so coordinators can cancel
-- a scheduled visit instead of leaving it stranded as 'scheduled'/'overdue'.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- New enum value.
--
-- HAZARD (PG12+): ALTER TYPE ... ADD VALUE is allowed inside a transaction,
-- but the new value must NOT be USED (cast, DML, column DEFAULT) in the same
-- transaction that adds it. This migration ONLY adds the value — no other
-- statement in this file may reference 'cancelled'. Do NOT add any
-- immediate cast / INSERT / seed using the new value to this file.
-- ---------------------------------------------------------------------------

ALTER TYPE site_visit_status ADD VALUE IF NOT EXISTS 'cancelled';
