-- =============================================================================
-- get_protocol_soa_footnotes — broaden the footnote-legend marker match.
--
-- The original RPC (20260707000000) only matched LETTERED legends
-- ("a. …", "b. …"): content ~ '(^|\n)\s*[a-z]\.\s'. Protocols that number their
-- footnotes ("1. …", "1) …") or use symbol markers ("* …", "† …", "‡ …", "§ …")
-- surfaced nothing in the Visit Prep Footnotes drawer.
--
-- This CREATE OR REPLACE widens the marker pattern to lettered ∪ numbered ∪
-- symbol. It is a strict SUPERSET of the lettered pattern → no regression for
-- protocols whose legends are lettered (e.g. BLKR201). Symbol legends chunk less
-- cleanly, so the drawer may read slightly messier for them — accepted.
--
-- Read-only, display-only: takes effect on EXISTING data immediately (no
-- re-ingest). Nothing else about the RPC changes — same SECURITY DEFINER +
-- user_can_access_protocol() gate, same {page, section, content} return shape.
-- Append-only migration.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_protocol_soa_footnotes(p_protocol_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Protocol-membership gate (same as the visit-execution RPCs). Empty result
  -- rather than leaking existence.
  IF NOT public.user_can_access_protocol(v_user, p_protocol_id) THEN
    RETURN json_build_object('footnotes', '[]'::json);
  END IF;

  RETURN json_build_object(
    'footnotes',
    COALESCE(
      (
        SELECT json_agg(
                 json_build_object('page', f.page_start, 'section', f.section_heading, 'content', f.content)
                 ORDER BY f.page_start NULLS LAST, f.content
               )
          FROM (
            -- DISTINCT collapses Reducto's duplicate continuation chunks so the
            -- drawer doesn't repeat the same legend several times.
            SELECT DISTINCT c.page_start, c.section_heading, c.content
              FROM chunks c
              JOIN documents d ON d.id = c.document_id
             WHERE d.protocol_id = p_protocol_id
               -- Under an SoA table / the Schedule-of-Activities section. Match
               -- section_heading OR content, because Reducto labels continuation
               -- pages with the doc running-header rather than the table title
               -- (so e.g. the MAD "Table 2" footnotes are only findable via content).
               AND (
                 c.section_heading ~* '(table\s*[0-9]|schedule of (activit|assessment|event))'
                 OR c.content ~* '(schedule of (activit|assessment|event)|##\s*table\s*[0-9])'
               )
               -- Footnote legends are list items. NB: `block_types` is a jsonb
               -- column but ingest stores a JSON.stringify'd value — a jsonb
               -- *string* scalar like "[\"List Item\"]", not an array — so the
               -- jsonb ?/@> operators don't apply; match on its text form.
               AND c.block_types::text ILIKE '%List Item%'
               -- … beginning with a legend marker: lettered ("a. …"), numbered
               -- ("1. …" / "1) …"), OR symbol ("* …", "† …", "‡ …", "§ …", "¶ …").
               AND c.content ~ '(^|\n)\s*([a-z]\.|[0-9]{1,2}[.)]|[*†‡§¶]+)\s'
          ) f
      ),
      '[]'::json
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_protocol_soa_footnotes(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_protocol_soa_footnotes IS
  'Display-only: returns SoA footnote chunks ({page, section, content}) for a '
  'protocol the caller can access. SECURITY DEFINER + user_can_access_protocol '
  'gate; reads chunks without widening their owner-scoped RLS. Marker match is '
  'lettered ∪ numbered ∪ symbol (* † ‡ § ¶). No parsing/linkage.';
