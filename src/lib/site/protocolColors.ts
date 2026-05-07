// =============================================================================
// Protocol color palette.
//
// Hand-picked entries for known study codes; deterministic-hash fallback for
// any unrecognised protocol so newly-uploaded studies always render with a
// stable, distinct color.
// =============================================================================

export interface ProtocolColors {
  dotLight: string;
  dotDark: string;
  chipLight: string;
  chipDark: string;
  accentLight: string;
  accentDark: string;
}

const COLOR_BLUE: ProtocolColors = {
  dotLight: 'bg-[#4a6fa5]',
  dotDark: 'bg-[#6e8fb5]',
  chipLight: 'bg-[#4a6fa5]/10 text-[#4a6fa5] border-[#4a6fa5]/20',
  chipDark: 'bg-[#6e8fb5]/15 text-[#6e8fb5] border-[#6e8fb5]/25',
  accentLight: 'border-l-[#4a6fa5]',
  accentDark: 'border-l-[#6e8fb5]',
};
const COLOR_TEAL: ProtocolColors = {
  dotLight: 'bg-[#2f8f86]',
  dotDark: 'bg-[#4fb5ab]',
  chipLight: 'bg-[#2f8f86]/10 text-[#2f8f86] border-[#2f8f86]/20',
  chipDark: 'bg-[#4fb5ab]/15 text-[#4fb5ab] border-[#4fb5ab]/25',
  accentLight: 'border-l-[#2f8f86]',
  accentDark: 'border-l-[#4fb5ab]',
};
const COLOR_VIOLET: ProtocolColors = {
  dotLight: 'bg-[#8866b0]',
  dotDark: 'bg-[#a884cc]',
  chipLight: 'bg-[#8866b0]/10 text-[#8866b0] border-[#8866b0]/20',
  chipDark: 'bg-[#a884cc]/15 text-[#a884cc] border-[#a884cc]/25',
  accentLight: 'border-l-[#8866b0]',
  accentDark: 'border-l-[#a884cc]',
};
const COLOR_AMBER: ProtocolColors = {
  dotLight: 'bg-[#c08a3e]',
  dotDark: 'bg-[#d6a45e]',
  chipLight: 'bg-[#c08a3e]/10 text-[#c08a3e] border-[#c08a3e]/20',
  chipDark: 'bg-[#d6a45e]/15 text-[#d6a45e] border-[#d6a45e]/25',
  accentLight: 'border-l-[#c08a3e]',
  accentDark: 'border-l-[#d6a45e]',
};
const COLOR_ROSE: ProtocolColors = {
  dotLight: 'bg-[#b04e6e]',
  dotDark: 'bg-[#cc7090]',
  chipLight: 'bg-[#b04e6e]/10 text-[#b04e6e] border-[#b04e6e]/20',
  chipDark: 'bg-[#cc7090]/15 text-[#cc7090] border-[#cc7090]/25',
  accentLight: 'border-l-[#b04e6e]',
  accentDark: 'border-l-[#cc7090]',
};
const COLOR_GREEN: ProtocolColors = {
  dotLight: 'bg-[#4f8a4a]',
  dotDark: 'bg-[#6fae6a]',
  chipLight: 'bg-[#4f8a4a]/10 text-[#4f8a4a] border-[#4f8a4a]/20',
  chipDark: 'bg-[#6fae6a]/15 text-[#6fae6a] border-[#6fae6a]/25',
  accentLight: 'border-l-[#4f8a4a]',
  accentDark: 'border-l-[#6fae6a]',
};
const COLOR_SLATE: ProtocolColors = {
  dotLight: 'bg-[#5a6c80]',
  dotDark: 'bg-[#7a8ca0]',
  chipLight: 'bg-[#5a6c80]/10 text-[#5a6c80] border-[#5a6c80]/20',
  chipDark: 'bg-[#7a8ca0]/15 text-[#7a8ca0] border-[#7a8ca0]/25',
  accentLight: 'border-l-[#5a6c80]',
  accentDark: 'border-l-[#7a8ca0]',
};
const COLOR_INDIGO: ProtocolColors = {
  dotLight: 'bg-[#5d5fb5]',
  dotDark: 'bg-[#8082d4]',
  chipLight: 'bg-[#5d5fb5]/10 text-[#5d5fb5] border-[#5d5fb5]/20',
  chipDark: 'bg-[#8082d4]/15 text-[#8082d4] border-[#8082d4]/25',
  accentLight: 'border-l-[#5d5fb5]',
  accentDark: 'border-l-[#8082d4]',
};

const PALETTE: ProtocolColors[] = [
  COLOR_BLUE,
  COLOR_TEAL,
  COLOR_VIOLET,
  COLOR_AMBER,
  COLOR_ROSE,
  COLOR_GREEN,
  COLOR_SLATE,
  COLOR_INDIGO,
];

// Hand-picked codes — keeps the existing demo protocols on their original colors.
export const PROTOCOL_COLORS: Record<string, ProtocolColors> = {
  'BRIGHTEN-2': COLOR_BLUE,
  'CARDIAC-7':  COLOR_TEAL,
  'IMMUNE-14':  COLOR_VIOLET,
  // legacy mock-id aliases (kept while MOCK_VISITS still uses these ids)
  'proto-001': COLOR_BLUE,
  'proto-002': COLOR_TEAL,
  'proto-003': COLOR_VIOLET,
};

// djb2 hash — deterministic, simple, no deps.
function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function fallbackColors(p: { id?: string; code?: string }): ProtocolColors {
  const key = p.code ?? p.id ?? '';
  return PALETTE[hashCode(key) % PALETTE.length];
}

export function getProtocolColors(p: { id?: string; code?: string } | null | undefined): ProtocolColors {
  if (!p) return COLOR_AMBER;
  if (p.code && PROTOCOL_COLORS[p.code]) return PROTOCOL_COLORS[p.code];
  if (p.id && PROTOCOL_COLORS[p.id]) return PROTOCOL_COLORS[p.id];
  return fallbackColors(p);
}

export function getProtocolColorsById(
  protocolId: string,
  protocols: { id: string; code: string }[],
): ProtocolColors {
  const p = protocols.find((x) => x.id === protocolId);
  return getProtocolColors(p ?? { id: protocolId });
}
