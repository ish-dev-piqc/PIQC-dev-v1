// =============================================================================
// Source of Truth Reviewer — Supabase RPC wrappers.
//
// Mirrors the pattern established in src/lib/audit/*Api.ts: thin wrappers
// around the sotr_* RPCs, typed with the DB row types from src/types/sotr.
// =============================================================================

import { supabase } from '../supabase';
import {
  MAX_WORKSHEET_ITEM_BATCH_SIZE,
} from '../../types/sotr';
import type {
  SourceEvidenceRecord,
  ExtractedItemRecord,
  ItemEvidenceLink,
  ItemWithEvidence,
  NewSourceEvidence,
  NewExtractedItem,
  AdapterOutput,
  WorksheetItemSourceEvidence,
  WorksheetItemsSourceEvidenceBatch,
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

// ---------------------------------------------------------------------------
// Review-screen API (PR-2).
//
// Thin wrappers around sotr_get_worksheet_item_evidence and the batch RPC.
// Both functions log only counts + IDs — never the response body, since
// sources[].source_text is sensitive protocol material.
// ---------------------------------------------------------------------------

export class WorksheetItemBatchTooLargeError extends Error {
  constructor(public readonly requested: number) {
    super(
      `Worksheet item batch size exceeds maximum (${MAX_WORKSHEET_ITEM_BATCH_SIZE}); requested ${requested}`,
    );
    this.name = 'WorksheetItemBatchTooLargeError';
  }
}

/**
 * Fetches one worksheet item plus its full source-evidence list, study-scoped.
 *
 * Errors propagate from the RPC: 'Not authenticated', 'Worksheet item not
 * found in study or access denied'. Missing evidence is NOT an error — the
 * response carries an empty sources[] array and a missing_source_reason.
 */
export async function fetchWorksheetItemSourceEvidence(
  studyId: string,
  worksheetItemId: string,
): Promise<WorksheetItemSourceEvidence> {
  const { data, error } = await supabase.rpc('sotr_get_worksheet_item_evidence', {
    p_study_id:          studyId,
    p_worksheet_item_id: worksheetItemId,
  });
  if (error) throw error;
  const result = data as WorksheetItemSourceEvidence;

  // Safe log: counts only — never the response body. source_text is sensitive.
  console.info('[sotr] worksheet item evidence fetched', {
    studyId,
    worksheetItemId,
    sourceCount:      result.sources.length,
    confidenceState:  result.confidence_state,
  });

  return result;
}

/**
 * Fetches source evidence for many worksheet items in one round trip.
 *
 * Validates the batch size client-side before hitting the RPC. Items the
 * caller cannot access (wrong owner, wrong study, missing) are silently
 * dropped from the response — diff returned vs requested IDs to detect them.
 */
/**
 * Lists worksheet items for a study, scoped through the caller's documents
 * (RLS enforces user_id; we filter to the caller's docs that match the
 * requested protocol_id).
 *
 * Direct supabase query rather than an RPC: RLS already covers
 * authorization, and the worksheet review screen's first paint just needs
 * to enumerate items. If we add aggregations or evidence counts later,
 * promote this to a dedicated RPC.
 */
export async function listWorksheetItemsForStudy(
  studyId: string,
): Promise<ExtractedItemRecord[]> {
  const { data, error } = await supabase
    .from('protocol_extracted_items')
    .select('*, documents!inner(id, protocol_id, user_id)')
    .eq('documents.protocol_id', studyId)
    .order('field_type', { ascending: true })
    .order('field_path', { ascending: true });
  if (error) throw error;
  // Strip the joined documents row — callers only need the item fields.
  return (data ?? []).map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { documents: _docs, ...item } = row as ExtractedItemRecord & {
      documents?: unknown;
    };
    return item as ExtractedItemRecord;
  });
}

/**
 * "Awaiting review" predicate — single source of truth for what counts as
 * an unreviewed worksheet item.
 *
 *   review_status === 'draft'  → initial state on extraction (PR-5 default)
 *   review_status === null     → legacy rows pre-PR-5
 *   any other value             → reviewed (accepted / edited / rejected / flagged)
 *
 * MUST stay aligned with the server-side OR clause in
 * countWorksheetItemsForStudy below. Client-side filters in WorksheetItemsList
 * (and any future caller) should import this rather than re-spelling the
 * predicate inline — drift here means the inline chip and the shell badge
 * silently disagree.
 */
export function isAwaitingReview(item: {
  review_status?: ExtractedItemRecord['review_status'] | null;
}): boolean {
  return !item.review_status || item.review_status === 'draft';
}

/**
 * Counts worksheet items for a study, split by "awaiting review" vs total.
 *
 * Used by Audit Mode (F-2) to surface the review queue size on the
 * "Protocol source" button + inside the drawer header without forcing the
 * auditor to open the drawer first. Same RLS gates as listWorksheetItemsForStudy.
 */
export interface WorksheetReviewCount {
  total: number;
  awaitingReview: number;
}

export async function countWorksheetItemsForStudy(
  studyId: string,
): Promise<WorksheetReviewCount> {
  const totalP = supabase
    .from('protocol_extracted_items')
    .select('id, documents!inner(protocol_id)', { count: 'exact', head: true })
    .eq('documents.protocol_id', studyId);

  const awaitingP = supabase
    .from('protocol_extracted_items')
    .select('id, documents!inner(protocol_id)', { count: 'exact', head: true })
    .eq('documents.protocol_id', studyId)
    .or('review_status.eq.draft,review_status.is.null');

  const [totalRes, awaitingRes] = await Promise.all([totalP, awaitingP]);
  if (totalRes.error) throw totalRes.error;
  if (awaitingRes.error) throw awaitingRes.error;

  return {
    total: totalRes.count ?? 0,
    awaitingReview: awaitingRes.count ?? 0,
  };
}

export async function fetchWorksheetItemsSourceEvidenceBatch(
  studyId: string,
  worksheetItemIds: string[],
): Promise<WorksheetItemsSourceEvidenceBatch> {
  if (worksheetItemIds.length > MAX_WORKSHEET_ITEM_BATCH_SIZE) {
    throw new WorksheetItemBatchTooLargeError(worksheetItemIds.length);
  }

  const { data, error } = await supabase.rpc('sotr_get_worksheet_items_evidence_batch', {
    p_study_id:           studyId,
    p_worksheet_item_ids: worksheetItemIds,
  });
  if (error) throw error;
  const result = data as WorksheetItemsSourceEvidenceBatch;

  console.info('[sotr] worksheet items evidence batch fetched', {
    studyId,
    requestedCount: worksheetItemIds.length,
    returnedCount:  result.items.length,
  });

  return result;
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
