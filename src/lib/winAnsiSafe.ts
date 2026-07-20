// =============================================================================
// winAnsiSafe — the WinAnsi (CP1252) text boundary for jsPDF exports.
//
// jsPDF's built-in helvetica is WinAnsi (CP1252)-only: glyphs outside that
// codepage silently print as mojibake ('⚠' -> '&', '✓' -> "'"). Every
// exporter that feeds DATA-DRIVEN strings (protocol-derived text) into
// doc.text() / autotable cells routes them through winAnsiSafe() at the
// point they reach the PDF. Hardcoded labels were made safe separately in
// the pdf-safe-glyphs pass (PR #518); this helper guards the data.
//
// Shared non-mode home: the VEW worksheet exporter
// (src/lib/visit-execution/visitExecutionExportApi.ts, where this first
// landed in PR #520) and the deliverables exporters (src/lib/deliverables/)
// draw with the same built-in font. Mode isolation forbids one lane
// importing the other, so the single copy lives here.
// =============================================================================

/**
 * ASCII transliterations for glyphs that appear routinely in clinical
 * protocol text. ≤ / ≥ / → and Greek mu are outside CP1252 entirely;
 * the micro sign (U+00B5) and multiplication sign (U+00D7) are technically
 * CP1252-representable but map to the same ASCII anyway, so the two
 * visually-identical mu variants can never behave differently. U+2212
 * (true minus) gets the same ASCII hyphen the hardcoded-label fix used.
 * Escaped keys on purpose: the mu twins are indistinguishable by eye.
 */
const WINANSI_TRANSLITERATIONS: ReadonlyMap<string, string> = new Map([
  ['\u2264', '<='], // ≤ less-than-or-equal
  ['\u2265', '>='], // ≥ greater-than-or-equal
  ['\u00b5', 'u'],  // µ micro sign
  ['\u03bc', 'u'],  // μ Greek small mu
  ['\u00d7', 'x'],  // × multiplication sign
  ['\u2192', '->'], // → rightwards arrow
  ['\u2212', '-'],  // − minus sign
]);

/** Codepoints CP1252 maps into its 0x80-0x9F band (curly quotes, dashes, ellipsis, bullet, etc.). */
const CP1252_EXTENSION = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
  0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c,
  0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

/**
 * CP1252-representable typography (em/en dashes, middle dot, section sign,
 * plus-minus, curly quotes, ellipsis, degree, Latin-1 accents) passes
 * through untouched; the clinically common symbols above transliterate to
 * ASCII; anything else outside CP1252 becomes '?' — a visible unknown beats
 * silent mojibake that could misread as data on a printed artifact.
 */
export function winAnsiSafe(text: string): string {
  return text.replace(/[^\x00-\x7f]/gu, (ch) => {
    const mapped = WINANSI_TRANSLITERATIONS.get(ch);
    if (mapped !== undefined) return mapped;
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0xa0 && cp <= 0xff) || CP1252_EXTENSION.has(cp)) return ch;
    return '?';
  });
}
