-- Remove documents from before user-scoping was added.
-- These have user_id = NULL and would be orphaned in the new model.
DELETE FROM documents WHERE user_id IS NULL;

SELECT id, title, user_id, extracted_fields IS NOT NULL as has_facts FROM documents;
