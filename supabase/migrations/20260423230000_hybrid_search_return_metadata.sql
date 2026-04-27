/*
  # hybrid_search: return chunk metadata for citations

  Adds page_start, page_end, section_heading, and block_types to the result
  set so the dashboard-chat function can attach citation info to streamed responses.

  Replaces both previous overloads (vector and float8[]) with a single float8[]
  signature (PostgREST-compatible) that also returns the new metadata columns.

  DROP required because Postgres won't allow CREATE OR REPLACE when the return
  type changes (new columns are added to RETURNS TABLE).
*/

-- Drop both overloads that may exist from prior migrations
DROP FUNCTION IF EXISTS public.hybrid_search(vector, text, integer, uuid[]);
DROP FUNCTION IF EXISTS public.hybrid_search(float8[], text, integer, uuid[]);
DROP FUNCTION IF EXISTS public.hybrid_search(vector(1536), text, integer);

CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding float8[],
  query_text text,
  match_count integer DEFAULT 20,
  filter_document_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  id uuid,
  document_id uuid,
  content text,
  chunk_index integer,
  similarity double precision,
  rank_score double precision,
  page_start integer,
  page_end integer,
  section_heading text,
  block_types jsonb
)
LANGUAGE sql
AS $$
WITH vector_ranked AS (
  SELECT
    c.id,
    c.document_id,
    c.content,
    c.chunk_index,
    c.page_start,
    c.page_end,
    c.section_heading,
    c.block_types,
    1 - (c.embedding <=> query_embedding::vector) AS similarity,
    ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding::vector) AS vector_rank
  FROM chunks c
  WHERE
    c.embedding IS NOT NULL
    AND (c.is_boilerplate IS NULL OR c.is_boilerplate = false)
    AND (filter_document_ids IS NULL OR c.document_id = ANY(filter_document_ids))
  ORDER BY c.embedding <=> query_embedding::vector
  LIMIT match_count * 2
),
fts_ranked AS (
  SELECT
    c.id,
    ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.fts, plainto_tsquery('english', query_text)) DESC) AS fts_rank
  FROM chunks c
  WHERE
    c.fts @@ plainto_tsquery('english', query_text)
    AND (c.is_boilerplate IS NULL OR c.is_boilerplate = false)
    AND (filter_document_ids IS NULL OR c.document_id = ANY(filter_document_ids))
  LIMIT match_count * 2
),
rrf AS (
  SELECT
    vr.id,
    vr.document_id,
    vr.content,
    vr.chunk_index,
    vr.page_start,
    vr.page_end,
    vr.section_heading,
    vr.block_types,
    vr.similarity,
    COALESCE(1.0 / (60 + vr.vector_rank), 0) + COALESCE(1.0 / (60 + fr.fts_rank), 0) AS rank_score
  FROM vector_ranked vr
  LEFT JOIN fts_ranked fr ON fr.id = vr.id
)
SELECT
  id,
  document_id,
  content,
  chunk_index,
  similarity,
  rank_score,
  page_start,
  page_end,
  section_heading,
  block_types
FROM rrf
ORDER BY rank_score DESC
LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.hybrid_search(float8[], text, integer, uuid[]) TO anon, authenticated, service_role;
