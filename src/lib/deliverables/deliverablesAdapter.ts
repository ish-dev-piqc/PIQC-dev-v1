// =============================================================================
// deliverablesAdapter — pure mappers between the deliverable_get_packet RPC
// JSON and the DeliverablePacket TS surface (src/types/deliverables).
//
// PURE: no supabase import, no side effects, never throws. RPC JSON is
// treated as untrusted input — every field read is defensive:
// - a null / non-object / id-less packet adapts to null ("no deliverable"),
// - a malformed block entry is SKIPPED (its valid siblings survive) rather
//   than sinking the whole packet,
// - missing display_text falls back to the contract's displayTextForBlock
//   semantics (current_text wins over derived_text, else '').
//
// SENSITIVE: source_quote / review_note flow through here — never log them.
// =============================================================================

import {
  ARTIFACT_TYPE_LABELS,
  type ChangeSummaryBlockRef,
  type DeliverableArtifactType,
  type DeliverableBlockType,
  type DeliverableChangeSummary,
  type DeliverableConfidenceState,
  type DeliverableContentOrigin,
  type DeliverableGenerationLog,
  type DeliverablePacket,
  type DeliverablePacketBlock,
  type DeliverableReviewState,
  type DeliverableSummary,
  type RemovedBlockSnapshot,
} from '../../types/deliverables';
import { displayTextForBlock } from '../../types/deliverables';

// -----------------------------------------------------------------------------
// Defensive readers + enum guards (mirror the Postgres enums exactly)
// -----------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Derived from ARTIFACT_TYPE_LABELS, whose Record<DeliverableArtifactType, …>
// type FORCES exhaustiveness — a hand-listed array here silently went stale
// when risk_overview landed (`satisfies T[]` accepts subsets), which nulled
// every risk-overview packet into "malformed RPC response".
const ARTIFACT_TYPES: ReadonlySet<string> = new Set(Object.keys(ARTIFACT_TYPE_LABELS));

const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'checklist_item',
  'section_intro',
  'site_question',
  'speaker_note',
] satisfies DeliverableBlockType[]);

const CONTENT_ORIGINS: ReadonlySet<string> = new Set([
  'protocol_fact',
  'derived_operational_framing',
  'human_editorial',
] satisfies DeliverableContentOrigin[]);

const REVIEW_STATES: ReadonlySet<string> = new Set([
  'draft',
  'needs_review',
  'reviewed',
  'edited',
  'rejected',
  'human_added',
] satisfies DeliverableReviewState[]);

const CONFIDENCE_STATES: ReadonlySet<string> = new Set([
  'high',
  'medium',
  'low',
  'needs_review',
] satisfies DeliverableConfidenceState[]);

// -----------------------------------------------------------------------------
// Block adapter
// -----------------------------------------------------------------------------

/**
 * Adapt one raw block entry from the packet's `blocks` array. Returns null
 * for anything unusable: not an object, empty/missing id or section_key, or
 * an enum field outside its Postgres enum (an unknown review_state must not
 * be silently rendered as something else — skipping is the honest failure).
 * Optional fields degrade instead: wrong-typed evidence fields become null,
 * missing version defaults to 1 (the contract's starting version), missing
 * sort_order to 0, and an invalid confidence_state degrades to null (framing
 * and human blocks legitimately carry none). A missing/invalid generation_seq
 * degrades to 1 — packets from a DB that predates the amendment-refresh
 * migration must keep adapting.
 */
export function adaptDeliverablePacketBlock(raw: unknown): DeliverablePacketBlock | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const id = asString(r.id);
  const sectionKey = asString(r.section_key);
  const blockType = asString(r.block_type);
  const contentOrigin = asString(r.content_origin);
  const reviewState = asString(r.review_state);

  if (!id || !sectionKey) return null;
  if (blockType === null || !BLOCK_TYPES.has(blockType)) return null;
  if (contentOrigin === null || !CONTENT_ORIGINS.has(contentOrigin)) return null;
  if (reviewState === null || !REVIEW_STATES.has(reviewState)) return null;

  const derivedText = asString(r.derived_text);
  const currentText = asString(r.current_text);
  const confidenceRaw = asString(r.confidence_state);

  return {
    id,
    section_key: sectionKey,
    block_type: blockType as DeliverableBlockType,
    content_origin: contentOrigin as DeliverableContentOrigin,
    display_text:
      asString(r.display_text) ??
      displayTextForBlock({ current_text: currentText, derived_text: derivedText }),
    derived_text: derivedText,
    current_text: currentText,
    source_evidence_id: asString(r.source_evidence_id),
    source_quote: asString(r.source_quote),
    source_page_number: asFiniteNumber(r.source_page_number),
    source_section: asString(r.source_section),
    confidence_state:
      confidenceRaw !== null && CONFIDENCE_STATES.has(confidenceRaw)
        ? (confidenceRaw as DeliverableConfidenceState)
        : null,
    review_state: reviewState as DeliverableReviewState,
    review_note: asString(r.review_note),
    version: asFiniteNumber(r.version) ?? 1,
    sort_order: asFiniteNumber(r.sort_order) ?? 0,
    generation_seq: asFiniteNumber(r.generation_seq) ?? 1,
  };
}

// -----------------------------------------------------------------------------
// Packet adapter
// -----------------------------------------------------------------------------

/**
 * Adapt the deliverable_get_packet JSON into a DeliverablePacket. Returns
 * null when the payload cannot represent a deliverable at all: null/undefined
 * (RPC's "no deliverable exists / not visible" answer), a non-object, missing
 * ids, or an artifact_type outside the enum. A missing/non-array `blocks`
 * degrades to an empty list; malformed entries inside it are skipped.
 */
export function adaptDeliverablePacket(raw: unknown): DeliverablePacket | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const deliverableId = asString(r.deliverable_id);
  const protocolId = asString(r.protocol_id);
  const artifactType = asString(r.artifact_type);

  if (!deliverableId || !protocolId) return null;
  if (artifactType === null || !ARTIFACT_TYPES.has(artifactType)) return null;

  const rawBlocks: unknown[] = Array.isArray(r.blocks) ? r.blocks : [];
  const blocks: DeliverablePacketBlock[] = [];
  for (const entry of rawBlocks) {
    const block = adaptDeliverablePacketBlock(entry);
    if (block !== null) blocks.push(block);
  }

  return {
    deliverable_id: deliverableId,
    protocol_id: protocolId,
    artifact_type: artifactType as DeliverableArtifactType,
    title: asString(r.title) ?? '',
    protocol_version: asString(r.protocol_version),
    generated_at: asString(r.generated_at) ?? '',
    regenerated_at: asString(r.regenerated_at),
    // Degrades to 1 on pre-migration packets (same tolerance as blocks).
    generation_seq: asFiniteNumber(r.generation_seq) ?? 1,
    blocks,
  };
}

// -----------------------------------------------------------------------------
// Change-summary adapter (deliverable_get_change_summary)
// -----------------------------------------------------------------------------

/** Entry in new_blocks / flagged_blocks: id + section_key + display_text,
 *  all required strings — anything else is skipped. */
function adaptChangeSummaryBlockRef(raw: unknown): ChangeSummaryBlockRef | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const id = asString(r.id);
  const sectionKey = asString(r.section_key);
  const displayText = asString(r.display_text);
  if (!id || !sectionKey || displayText === null) return null;

  return { id, section_key: sectionKey, display_text: displayText };
}

/** Removed-block snapshot from the generation log's JSONB: section_key +
 *  derived_text strings and a block_type inside the enum, or skipped. */
function adaptRemovedBlockSnapshot(raw: unknown): RemovedBlockSnapshot | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const sectionKey = asString(r.section_key);
  const blockType = asString(r.block_type);
  const derivedText = asString(r.derived_text);
  if (!sectionKey || derivedText === null) return null;
  if (blockType === null || !BLOCK_TYPES.has(blockType)) return null;

  return {
    section_key: sectionKey,
    block_type: blockType as DeliverableBlockType,
    derived_text: derivedText,
  };
}

/** Generation-log row, adapted tolerantly: ids are required, counters
 *  degrade to 0, generation_seq to 1, and removed_blocks entries are
 *  adapted entry-by-entry (malformed ones skipped). */
function adaptGenerationLog(raw: unknown): DeliverableGenerationLog | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const id = asString(r.id);
  const deliverableId = asString(r.deliverable_id);
  if (!id || !deliverableId) return null;

  const rawRemoved: unknown[] = Array.isArray(r.removed_blocks) ? r.removed_blocks : [];
  const removedBlocks: RemovedBlockSnapshot[] = [];
  for (const entry of rawRemoved) {
    const snapshot = adaptRemovedBlockSnapshot(entry);
    if (snapshot !== null) removedBlocks.push(snapshot);
  }

  return {
    id,
    deliverable_id: deliverableId,
    generation_seq: asFiniteNumber(r.generation_seq) ?? 1,
    protocol_version: asString(r.protocol_version),
    generated_by: asString(r.generated_by),
    generated_at: asString(r.generated_at) ?? '',
    blocks_created: asFiniteNumber(r.blocks_created) ?? 0,
    blocks_matched: asFiniteNumber(r.blocks_matched) ?? 0,
    blocks_kept_flagged: asFiniteNumber(r.blocks_kept_flagged) ?? 0,
    blocks_deleted: asFiniteNumber(r.blocks_deleted) ?? 0,
    removed_blocks: removedBlocks,
  };
}

/**
 * Adapt the deliverable_get_change_summary JSON. Returns null for anything
 * that is not an object (the RPC's SQL-NULL "no deliverable" answer is
 * handled by the API layer before this runs). Inside a summary object,
 * everything degrades instead of failing: a malformed log sub-object becomes
 * null (the summary's own "no log yet" value), and each of the three lists
 * is adapted entry-by-entry with malformed entries skipped.
 */
export function adaptChangeSummary(raw: unknown): DeliverableChangeSummary | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const newBlocks: ChangeSummaryBlockRef[] = [];
  const rawNew: unknown[] = Array.isArray(r.new_blocks) ? r.new_blocks : [];
  for (const entry of rawNew) {
    const ref = adaptChangeSummaryBlockRef(entry);
    if (ref !== null) newBlocks.push(ref);
  }

  const flaggedBlocks: ChangeSummaryBlockRef[] = [];
  const rawFlagged: unknown[] = Array.isArray(r.flagged_blocks) ? r.flagged_blocks : [];
  for (const entry of rawFlagged) {
    const ref = adaptChangeSummaryBlockRef(entry);
    if (ref !== null) flaggedBlocks.push(ref);
  }

  const removedBlocks: RemovedBlockSnapshot[] = [];
  const rawRemoved: unknown[] = Array.isArray(r.removed_blocks) ? r.removed_blocks : [];
  for (const entry of rawRemoved) {
    const snapshot = adaptRemovedBlockSnapshot(entry);
    if (snapshot !== null) removedBlocks.push(snapshot);
  }

  return {
    log: adaptGenerationLog(r.log),
    new_blocks: newBlocks,
    flagged_blocks: flaggedBlocks,
    removed_blocks: removedBlocks,
  };
}

// -----------------------------------------------------------------------------
// Overview adapter — deliverable_list_summary → DeliverableSummary[]
// -----------------------------------------------------------------------------

/**
 * Adapt the deliverable_list_summary array (one entry per existing deliverable).
 * A non-array payload adapts to [] (the empty-board case). Each entry is dropped
 * — not defaulted — when it lacks a usable id, generated_at, or a recognized
 * artifact_type (ARTIFACT_TYPES is the whitelist-from-labels set; an unknown
 * type must never render as a mislabeled card). Counts default to 0, generation
 * seq to 1, so a partially-shaped row still summarizes rather than sinking the
 * whole board.
 */
export function adaptDeliverableSummaries(raw: unknown): DeliverableSummary[] {
  if (!Array.isArray(raw)) return [];

  const out: DeliverableSummary[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;

    const deliverableId = asString(e.deliverable_id);
    const artifactType = asString(e.artifact_type);
    const generatedAt = asString(e.generated_at);
    if (!deliverableId || !generatedAt) continue;
    if (artifactType === null || !ARTIFACT_TYPES.has(artifactType)) continue;

    out.push({
      deliverable_id: deliverableId,
      artifact_type: artifactType as DeliverableArtifactType,
      title: asString(e.title) ?? '',
      protocol_version: asString(e.protocol_version),
      generated_at: generatedAt,
      regenerated_at: asString(e.regenerated_at),
      generation_seq: asFiniteNumber(e.generation_seq) ?? 1,
      total_blocks: asFiniteNumber(e.total_blocks) ?? 0,
      reviewed_blocks: asFiniteNumber(e.reviewed_blocks) ?? 0,
      needs_review_blocks: asFiniteNumber(e.needs_review_blocks) ?? 0,
    });
  }
  return out;
}
