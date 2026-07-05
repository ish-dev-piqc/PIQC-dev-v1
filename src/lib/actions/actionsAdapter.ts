// =============================================================================
// actionsAdapter — pure mappers between the action_cards_get RPC JSON and the
// ActionCardRecord TS surface (src/types/actions).
//
// PURE: no supabase import, no side effects, never throws. RPC JSON is
// treated as untrusted: a malformed card entry is SKIPPED (valid siblings
// survive); enum fields outside their CHECK constraints reject the entry
// (an unknown status must not render as something else).
//
// SENSITIVE: rationale / disclaimer bodies flow through here — never log.
// =============================================================================

import type {
  ActionCardRecord,
  ActionCardStatus,
  ActionDestinationType,
  ActionSuggestedWindow,
} from '../../types/actions';
import { DESTINATION_LABELS } from '../../types/actions';

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// Derived from DESTINATION_LABELS (Record<ActionDestinationType, …> forces
// exhaustiveness) — same anti-stale-whitelist discipline as the deliverables
// adapter, learned the hard way in PR #409's review.
const DESTINATION_TYPES: ReadonlySet<string> = new Set(Object.keys(DESTINATION_LABELS));

const STATUSES: ReadonlySet<string> = new Set([
  'suggested',
  'dismissed',
  'acted',
] satisfies ActionCardStatus[]);

function asEvidenceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0) ids.push(entry);
  }
  return ids;
}

function asWindow(value: unknown): ActionSuggestedWindow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const start = asString(r.start_iso);
  const end = asString(r.end_iso);
  return start && end ? { start_iso: start, end_iso: end } : null;
}

/** Adapt one raw card entry. Null for anything unusable. */
export function adaptActionCard(raw: unknown): ActionCardRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const id = asString(r.id);
  const protocolId = asString(r.protocol_id);
  const triggerContext = asString(r.trigger_context);
  const title = asString(r.title);
  const rationale = asString(r.rationale);
  const disclaimer = asString(r.disclaimer);
  const destination = asString(r.external_destination_type);
  const status = asString(r.status);

  if (!id || !protocolId || !triggerContext || !title || !rationale || !disclaimer) {
    return null;
  }
  if (destination === null || !DESTINATION_TYPES.has(destination)) return null;
  if (status === null || !STATUSES.has(status)) return null;

  return {
    id,
    protocol_id: protocolId,
    deliverable_id: asString(r.deliverable_id),
    trigger_context: triggerContext,
    title,
    rationale,
    protocol_evidence_ids: asEvidenceIds(r.protocol_evidence_ids),
    suggested_window: asWindow(r.suggested_window),
    external_destination_type: destination as ActionDestinationType,
    external_url_or_template: asString(r.external_url_or_template),
    disclaimer,
    status: status as ActionCardStatus,
    created_at: asString(r.created_at) ?? '',
    updated_at: asString(r.updated_at) ?? '',
  };
}

/** Adapt the action_cards_get payload (jsonb array). Malformed entries are
 *  skipped; a non-array payload adapts to an empty list (the RPC never
 *  returns NULL — an empty array is the "no cards" answer). */
export function adaptActionCards(raw: unknown): ActionCardRecord[] {
  if (!Array.isArray(raw)) return [];
  const cards: ActionCardRecord[] = [];
  for (const entry of raw) {
    const card = adaptActionCard(entry);
    if (card !== null) cards.push(card);
  }
  return cards;
}
