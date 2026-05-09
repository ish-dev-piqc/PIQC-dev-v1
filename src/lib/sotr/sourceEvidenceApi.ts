// =============================================================================
// Source of Truth Reviewer — Supabase RPC wrappers.
//
// Mirrors the pattern established in src/lib/audit/*Api.ts: thin wrappers
// around the sotr_* RPCs, typed with the DB row types from src/types/sotr.
// =============================================================================

import { supabase } from '../supabase';
import type {
  SourceEvidenceRecord,
  ExtractedItemRecord,
  ItemEvidenceLink,
  ItemWithEvidence,
  NewSourceEvidence,
  NewExtractedItem,
  AdapterOutput,
} from '../../types/sotr';

export async function upsertSourceEvidence(
  ev: NewSourceEvidence,
): Promise<SourceEvidenceRecord> {
  const { data, error } = await supabase.rpc('sotr_upsert_source_evidence', {
    p_document_id:         ev.document_id,
    p_protocol_version:    ev.protocol_version    ?? null,
    p_page_number:         ev.page_number         ?? null,
    p_section_number:      ev.section_number      ?? null,
    p_section_title:       ev.section_title       ?? null,
    p_quoted_text:         ev.quoted_text         ?? null,
    p_text_start_offset:   ev.text_start_offset   ?? null,
    p_text_end_offset:     ev.text_end_offset     ?? null,
    p_bounding_boxes:      ev.bounding_boxes      ?? null,
    p_confidence_score:    ev.confidence_score    ?? null,
    p_support_type:        ev.support_type,
    p_extraction_run_id:   ev.extraction_run_id   ?? null,
  });
  if (error) throw error;
  return data as SourceEvidenceRecord;
}

export async function upsertExtractedItem(
  item: NewExtractedItem,
): Promise<ExtractedItemRecord> {
  const { data, error } = await supabase.rpc('sotr_upsert_extracted_item', {
    p_document_id:           item.document_id,
    p_field_path:            item.field_path,
    p_field_type:            item.field_type,
    p_extracted_value:       item.extracted_value,
    p_confidence_state:      item.confidence_state,
    p_confidence_score:      item.confidence_score      ?? null,
    p_confidence_reason:     item.confidence_reason     ?? null,
    p_ambiguity_reason:      item.ambiguity_reason      ?? null,
    p_missing_source_reason: item.missing_source_reason ?? null,
  });
  if (error) throw error;
  return data as ExtractedItemRecord;
}

export async function linkItemEvidence(
  extractedItemId: string,
  sourceEvidenceId: string,
  isPrimary: boolean,
  relevanceScore?: number | null,
): Promise<ItemEvidenceLink> {
  const { data, error } = await supabase.rpc('sotr_link_item_evidence', {
    p_extracted_item_id:  extractedItemId,
    p_source_evidence_id: sourceEvidenceId,
    p_is_primary_source:  isPrimary,
    p_relevance_score:    relevanceScore ?? null,
  });
  if (error) throw error;
  return data as ItemEvidenceLink;
}

export async function getItemWithEvidence(
  extractedItemId: string,
): Promise<ItemWithEvidence> {
  const { data, error } = await supabase.rpc('sotr_get_item_evidence', {
    p_extracted_item_id: extractedItemId,
  });
  if (error) throw error;
  return data as ItemWithEvidence;
}

/**
 * Persists the full output of mapReductoExtractToSotr: writes evidence rows,
 * item rows, and links in sequence.
 *
 * Returns the DB-assigned IDs so callers can update downstream records
 * (e.g. setting extracted_item_id on protocol_visit_templates rows).
 */
export async function persistAdapterOutput(
  output: AdapterOutput,
): Promise<{ itemIds: string[]; evidenceIds: string[] }> {
  const evidenceIds: string[] = [];
  for (const ev of output.evidence) {
    const row = await upsertSourceEvidence(ev);
    evidenceIds.push(row.id);
  }

  const itemIds: string[] = [];
  for (const item of output.items) {
    const row = await upsertExtractedItem(item);
    itemIds.push(row.id);
  }

  for (const link of output.links) {
    await linkItemEvidence(
      itemIds[link.item_index],
      evidenceIds[link.evidence_index],
      link.is_primary_source,
      link.relevance_score ?? null,
    );
  }

  return { itemIds, evidenceIds };
}
