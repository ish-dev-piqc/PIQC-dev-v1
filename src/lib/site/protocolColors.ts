// =============================================================================
// Protocol color palette — single source of truth for visit dots, chips,
// and calendar accents. Re-exports the demo palette from mockCalendarData
// and adds helpers that work on either a code string or a protocol UUID.
//
// Real protocols (from Supabase) get a color derived from their
// `study_number` / code by hashing into the demo palette, so the calendar
// stays visually consistent even when the protocols aren't the 3 demo ones.
// =============================================================================

import { PROTOCOL_COLORS } from '../mockCalendarData';
import type { Protocol } from '../../context/ProtocolContext';

export { PROTOCOL_COLORS };

// One row of the palette — derived from PROTOCOL_COLORS' value type so we
// don't have to keep this declaration in sync by hand.
export type ProtocolColors = (typeof PROTOCOL_COLORS)[keyof typeof PROTOCOL_COLORS];

const DEMO_PROTO_KEYS = ['proto-001', 'proto-002', 'proto-003'] as const;

// Stable per-string hash → bucket into the demo palette. Deterministic so
// the same protocol always gets the same color across reloads.
function hashToIndex(s: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) % modulo;
}

// Returns the demo color for a known key; falls back to a hash-derived
// palette entry. Never throws.
export function getProtocolColors(code: string | null | undefined): ProtocolColors {
  if (code && code in PROTOCOL_COLORS) return PROTOCOL_COLORS[code];
  const fallbackKey = DEMO_PROTO_KEYS[hashToIndex(code ?? '', DEMO_PROTO_KEYS.length)];
  return PROTOCOL_COLORS[fallbackKey];
}

// Resolve colors for a visit using its protocolId — accepts the protocols
// list so the lookup is mock-friendly (demo IDs) AND Supabase-friendly
// (real UUIDs that hash to a palette slot).
export function getProtocolColorsById(
  protocolId: string,
  protocols: Protocol[],
): ProtocolColors {
  if (protocolId in PROTOCOL_COLORS) return PROTOCOL_COLORS[protocolId];
  const found = protocols.find((p) => p.id === protocolId);
  return getProtocolColors(found?.code ?? protocolId);
}
