// =============================================================================
// Protocol color palette — single source of truth for visit dots, chips,
// and calendar accents.
//
// Owns the actual `PROTOCOL_COLORS` literal. `mockCalendarData.ts` keeps a
// re-export for legacy consumers but does NOT define the palette here; if
// you change colors, change them in this file.
//
// Real protocols (from Supabase) get a color derived from their `code` /
// `study_number` by hashing into the demo palette, so the calendar stays
// visually consistent even when the protocols aren't the 3 demo ones.
// =============================================================================

import type { Protocol } from '../../context/ProtocolContext';

export interface ProtocolColors {
  dotLight: string;
  dotDark: string;
  chipLight: string;
  chipDark: string;
  accentLight: string;
  accentDark: string;
}

export const PROTOCOL_COLORS: Record<string, ProtocolColors> = {
  'proto-001': {
    // BRIGHTEN-2 — blue
    dotLight: 'bg-[#4a6fa5]',
    dotDark: 'bg-[#6e8fb5]',
    chipLight: 'bg-[#4a6fa5]/10 text-[#4a6fa5] border-[#4a6fa5]/20',
    chipDark: 'bg-[#6e8fb5]/15 text-[#6e8fb5] border-[#6e8fb5]/25',
    accentLight: 'border-l-[#4a6fa5]',
    accentDark: 'border-l-[#6e8fb5]',
  },
  'proto-002': {
    // CARDIAC-7 — teal
    dotLight: 'bg-[#2f8f86]',
    dotDark: 'bg-[#4fb5ab]',
    chipLight: 'bg-[#2f8f86]/10 text-[#2f8f86] border-[#2f8f86]/20',
    chipDark: 'bg-[#4fb5ab]/15 text-[#4fb5ab] border-[#4fb5ab]/25',
    accentLight: 'border-l-[#2f8f86]',
    accentDark: 'border-l-[#4fb5ab]',
  },
  'proto-003': {
    // IMMUNE-14 — violet
    dotLight: 'bg-[#8866b0]',
    dotDark: 'bg-[#a884cc]',
    chipLight: 'bg-[#8866b0]/10 text-[#8866b0] border-[#8866b0]/20',
    chipDark: 'bg-[#a884cc]/15 text-[#a884cc] border-[#a884cc]/25',
    accentLight: 'border-l-[#8866b0]',
    accentDark: 'border-l-[#a884cc]',
  },
};

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
