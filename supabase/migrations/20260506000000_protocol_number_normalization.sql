-- =============================================================================
-- protocols.study_number normalization.
--
-- Phase A pipeline relies on auto-linking uploaded documents to the protocol
-- they describe via `extracted_fields.protocol_number`. Protocol numbers
-- appear in many surface forms across the same study ("NCT-04123456",
-- "nct04123456", "NCT 04123456"), so we maintain a normalized form on the
-- protocols row and look up against that.
--
-- normalize_protocol_number(text): lowercase, strip everything that isn't
-- alphanumeric. Idempotent and stable; safe to call on null. Used by both
-- the auto-tag trigger on documents and by the trigger maintaining
-- protocols.study_number_normalized below.
-- =============================================================================

CREATE OR REPLACE FUNCTION normalize_protocol_number(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]', '', 'g');
$$;

ALTER TABLE protocols
  ADD COLUMN study_number_normalized TEXT;

UPDATE protocols
   SET study_number_normalized = normalize_protocol_number(study_number)
 WHERE study_number IS NOT NULL;

CREATE UNIQUE INDEX protocols_study_number_normalized_uniq
  ON protocols(study_number_normalized)
  WHERE study_number_normalized IS NOT NULL AND study_number_normalized <> '';

CREATE OR REPLACE FUNCTION protocols_sync_study_number_normalized()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.study_number_normalized := normalize_protocol_number(NEW.study_number);
  RETURN NEW;
END;
$$;

CREATE TRIGGER protocols_sync_study_number_normalized_trg
  BEFORE INSERT OR UPDATE OF study_number ON protocols
  FOR EACH ROW EXECUTE FUNCTION protocols_sync_study_number_normalized();
