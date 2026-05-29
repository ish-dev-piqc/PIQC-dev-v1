// =============================================================================
// Protocol color palette — single source of truth for visit dots, chips,
// calendar accents, and protocol/audit picker dots.
//
// Design constraints:
//  - 9 curated colors, maximally spaced around the color wheel.
//  - NO blue and NO teal — those are reserved for the mode-aware brand
//    anchors (Site Mode = blue, Audit Mode = teal).
//  - NO emerald, amber, or rose — those are reserved for semantic status
//    (success / warning / error). Reusing them as protocol colors would
//    cause subconscious "this protocol is an error" confusion at the chip
//    level where alphas overlap.
//  - Saturation + lightness chosen to harmonize with the brand palette
//    (similar boldness, similar weight in the UI) without competing.
//
// Each entry uses Tailwind-equivalent -600 weights for light mode (deeper,
// readable on white backgrounds) and -400 weights for dark mode (brighter,
// readable on near-black backgrounds).
//
// Protocol → color assignment is hash-based and deterministic: the same
// protocol code always gets the same color across reloads. With 9 curated
// colors, workspaces with up to ~9 protocols are very likely to get unique
// colors per protocol. Beyond 9, hash collisions occur (two protocols
// share a color). Adding an algorithmic fallback for unbounded uniqueness
// would require either inline-style support in every consumer or a
// pre-generated Tailwind safelist — punted to a follow-up if collisions
// become a real problem in production.
//
// `mockCalendarData.ts` keeps a re-export for legacy consumers but does NOT
// define the palette here; if you change colors, change them in this file.
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

// -----------------------------------------------------------------------------
// Curated palette — 9 distinct hues, in color-wheel order so adjacent
// entries are still visually distinguishable.
// -----------------------------------------------------------------------------
const PROTOCOL_PALETTE: ProtocolColors[] = [
  // 0 — Indigo (purple-blue, distinct from brand blue)
  {
    dotLight: 'bg-[#4F46E5]',
    dotDark: 'bg-[#818CF8]',
    chipLight: 'bg-[#4F46E5]/10 text-[#4F46E5] border-[#4F46E5]/20',
    chipDark: 'bg-[#818CF8]/15 text-[#818CF8] border-[#818CF8]/25',
    accentLight: 'border-l-[#4F46E5]',
    accentDark: 'border-l-[#818CF8]',
  },
  // 1 — Violet
  {
    dotLight: 'bg-[#7C3AED]',
    dotDark: 'bg-[#A78BFA]',
    chipLight: 'bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/20',
    chipDark: 'bg-[#A78BFA]/15 text-[#A78BFA] border-[#A78BFA]/25',
    accentLight: 'border-l-[#7C3AED]',
    accentDark: 'border-l-[#A78BFA]',
  },
  // 2 — Fuchsia (vivid magenta)
  {
    dotLight: 'bg-[#C026D3]',
    dotDark: 'bg-[#E879F9]',
    chipLight: 'bg-[#C026D3]/10 text-[#C026D3] border-[#C026D3]/20',
    chipDark: 'bg-[#E879F9]/15 text-[#E879F9] border-[#E879F9]/25',
    accentLight: 'border-l-[#C026D3]',
    accentDark: 'border-l-[#E879F9]',
  },
  // 3 — Pink (rose-pink, distinct from semantic rose by saturation)
  {
    dotLight: 'bg-[#DB2777]',
    dotDark: 'bg-[#F472B6]',
    chipLight: 'bg-[#DB2777]/10 text-[#DB2777] border-[#DB2777]/20',
    chipDark: 'bg-[#F472B6]/15 text-[#F472B6] border-[#F472B6]/25',
    accentLight: 'border-l-[#DB2777]',
    accentDark: 'border-l-[#F472B6]',
  },
  // 4 — Red (distinct from semantic rose by hue)
  {
    dotLight: 'bg-[#DC2626]',
    dotDark: 'bg-[#F87171]',
    chipLight: 'bg-[#DC2626]/10 text-[#DC2626] border-[#DC2626]/20',
    chipDark: 'bg-[#F87171]/15 text-[#F87171] border-[#F87171]/25',
    accentLight: 'border-l-[#DC2626]',
    accentDark: 'border-l-[#F87171]',
  },
  // 5 — Orange
  {
    dotLight: 'bg-[#EA580C]',
    dotDark: 'bg-[#FB923C]',
    chipLight: 'bg-[#EA580C]/10 text-[#EA580C] border-[#EA580C]/20',
    chipDark: 'bg-[#FB923C]/15 text-[#FB923C] border-[#FB923C]/25',
    accentLight: 'border-l-[#EA580C]',
    accentDark: 'border-l-[#FB923C]',
  },
  // 6 — Yellow (distinct from semantic amber by hue)
  {
    dotLight: 'bg-[#CA8A04]',
    dotDark: 'bg-[#FACC15]',
    chipLight: 'bg-[#CA8A04]/10 text-[#CA8A04] border-[#CA8A04]/20',
    chipDark: 'bg-[#FACC15]/15 text-[#FACC15] border-[#FACC15]/25',
    accentLight: 'border-l-[#CA8A04]',
    accentDark: 'border-l-[#FACC15]',
  },
  // 7 — Lime
  {
    dotLight: 'bg-[#65A30D]',
    dotDark: 'bg-[#A3E635]',
    chipLight: 'bg-[#65A30D]/10 text-[#65A30D] border-[#65A30D]/20',
    chipDark: 'bg-[#A3E635]/15 text-[#A3E635] border-[#A3E635]/25',
    accentLight: 'border-l-[#65A30D]',
    accentDark: 'border-l-[#A3E635]',
  },
  // 8 — Green (distinct from semantic emerald — green is yellower)
  {
    dotLight: 'bg-[#16A34A]',
    dotDark: 'bg-[#4ADE80]',
    chipLight: 'bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/20',
    chipDark: 'bg-[#4ADE80]/15 text-[#4ADE80] border-[#4ADE80]/25',
    accentLight: 'border-l-[#16A34A]',
    accentDark: 'border-l-[#4ADE80]',
  },
];

// -----------------------------------------------------------------------------
// Hash a string into a deterministic non-negative integer. djb2-ish.
// Same input → same output across reloads.
// -----------------------------------------------------------------------------
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// -----------------------------------------------------------------------------
// Public API — same surface as before, never throws, deterministic.
// Same `code` always gets the same color across reloads.
// -----------------------------------------------------------------------------
export function getProtocolColors(code: string | null | undefined): ProtocolColors {
  const key = code ?? '';
  return PROTOCOL_PALETTE[hashCode(key) % PROTOCOL_PALETTE.length];
}

// -----------------------------------------------------------------------------
// Resolve colors for a visit using its protocolId — accepts the protocols
// list so the lookup is mock-friendly (demo IDs) AND Supabase-friendly
// (real UUIDs that hash to a palette slot).
// -----------------------------------------------------------------------------
export function getProtocolColorsById(
  protocolId: string,
  protocols: Protocol[],
): ProtocolColors {
  const found = protocols.find((p) => p.id === protocolId);
  return getProtocolColors(found?.code ?? protocolId);
}

// -----------------------------------------------------------------------------
// Back-compat re-export. The named `PROTOCOL_COLORS` object used to be a
// `Record<string, ProtocolColors>` keyed by demo protocol IDs. Some callers
// (notably mockCalendarData.ts) still reference it. We expose the curated
// palette under the demo keys so legacy consumers continue to resolve to
// a curated color without code changes.
// -----------------------------------------------------------------------------
export const PROTOCOL_COLORS: Record<string, ProtocolColors> = {
  'proto-001': PROTOCOL_PALETTE[0], // was blue, now indigo
  'proto-002': PROTOCOL_PALETTE[7], // was teal, now lime (greenest non-conflict)
  'proto-003': PROTOCOL_PALETTE[1], // was violet, stays violet-family
};
