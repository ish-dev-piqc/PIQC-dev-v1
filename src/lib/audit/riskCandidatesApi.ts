import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import { CANDIDATE_FIELD_TYPES, type CandidateSourceItem } from './riskCandidates';

// =============================================================================
// Risk candidates — read side.
//
// Loads the SOTR worksheet items that deriveRiskCandidates (pure) turns into
// proposals: the protocol's items of a candidate type, from READY documents
// only, plus each item's primary source-evidence coordinates (section and
// page — never the quoted text; the candidate row shows where, the drawer
// shows what).
//
// The item query mirrors src/lib/sotr/sourceEvidenceApi.ts's
// listWorksheetItemsForStudy — mode isolation forbids importing it. Reach is
// whatever RLS grants the caller: own documents today, the protocols of
// audits the caller leads once 20260912000000's policies are applied.
// =============================================================================

interface ItemRow {
  id: string;
  document_id: string;
  field_path: string;
  field_type: string;
  extracted_value: unknown;
  confidence_state: CandidateSourceItem['confidence_state'];
  review_status: CandidateSourceItem['review_status'] | undefined;
  current_text: string | null | undefined;
}

interface EvidenceCoordinates {
  section_number: string | null;
  page_number: number | null;
}

interface EvidenceLinkRow {
  extracted_item_id: string;
  /** Many-to-one embed, so PostgREST returns one object; typed to tolerate
   *  the array form so a relationship-detection change degrades to "no
   *  evidence" rather than a crash. */
  protocol_source_evidence: EvidenceCoordinates | EvidenceCoordinates[] | null;
}

/** Keeps the .in() URL well under proxy limits for large worksheets. */
const EVIDENCE_LOOKUP_CHUNK = 100;

export async function fetchCandidateSourceItems(
  protocolId: string,
): Promise<Result<CandidateSourceItem[]>> {
  const { data, error } = await supabase
    .from('protocol_extracted_items')
    .select(
      'id, document_id, field_path, field_type, extracted_value, confidence_state, review_status, current_text, documents!inner(protocol_id, status)',
    )
    .eq('documents.protocol_id', protocolId)
    .eq('documents.status', 'ready')
    .in('field_type', [...CANDIDATE_FIELD_TYPES])
    .order('field_path', { ascending: true });

  if (error) {
    console.error('[riskCandidatesApi] fetchCandidateSourceItems — items lookup failed:', error);
    return { ok: false, error: error.message };
  }

  const rows = (data ?? []) as ItemRow[];
  if (rows.length === 0) return { ok: true, data: [] };

  const evidence = await fetchPrimaryEvidence(rows.map((r) => r.id));
  if (!evidence.ok) return evidence;

  return {
    ok: true,
    data: rows.map((r) => {
      const coords = evidence.data.get(r.id);
      return {
        id: r.id,
        document_id: r.document_id,
        field_path: r.field_path,
        field_type: r.field_type,
        extracted_value: r.extracted_value,
        confidence_state: r.confidence_state,
        review_status: r.review_status ?? null,
        current_text: r.current_text ?? null,
        section_number: coords?.section_number ?? null,
        page_number: coords?.page_number ?? null,
      };
    }),
  };
}

/** One primary-evidence lookup per chunk of item ids, merged into a map.
 *  An item with several primary links keeps the first returned. */
async function fetchPrimaryEvidence(
  itemIds: string[],
): Promise<Result<Map<string, EvidenceCoordinates>>> {
  const chunks: string[][] = [];
  for (let i = 0; i < itemIds.length; i += EVIDENCE_LOOKUP_CHUNK) {
    chunks.push(itemIds.slice(i, i + EVIDENCE_LOOKUP_CHUNK));
  }

  const results = await Promise.all(
    chunks.map((ids) =>
      supabase
        .from('protocol_item_evidence_links')
        .select('extracted_item_id, protocol_source_evidence(section_number, page_number)')
        .in('extracted_item_id', ids)
        .eq('is_primary_source', true),
    ),
  );

  const byItem = new Map<string, EvidenceCoordinates>();
  for (const { data, error } of results) {
    if (error) {
      console.error('[riskCandidatesApi] fetchCandidateSourceItems — evidence lookup failed:', error);
      return { ok: false, error: error.message };
    }
    for (const link of (data ?? []) as EvidenceLinkRow[]) {
      if (byItem.has(link.extracted_item_id)) continue;
      const embedded = link.protocol_source_evidence;
      const coords = Array.isArray(embedded) ? embedded[0] ?? null : embedded;
      if (!coords) continue;
      byItem.set(link.extracted_item_id, {
        section_number: coords.section_number ?? null,
        page_number: coords.page_number ?? null,
      });
    }
  }
  return { ok: true, data: byItem };
}
