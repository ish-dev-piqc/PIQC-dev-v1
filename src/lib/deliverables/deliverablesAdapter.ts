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

import type {
  DeliverableArtifactType,
  DeliverableBlockType,
  DeliverableConfidenceState,
  DeliverableContentOrigin,
  DeliverablePacket,
  DeliverablePacketBlock,
  DeliverableReviewState,
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

const ARTIFACT_TYPES: ReadonlySet<string> = new Set([
  'monitoring_prep_checklist',
] satisfies DeliverableArtifactType[]);

const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'checklist_item',
  'section_intro',
  'site_question',
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
 * and human blocks legitimately carry none).
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
    blocks,
  };
}
