// =============================================================================
// Design tokens — one source of truth for color, spacing, type, radii.
//
// Inline-styled components import these directly; future CSS modules can read
// them via the CSS custom properties registered in app/globals.css. When the
// palette or scale changes, this file is the only edit.
//
// Color contrast (WCAG 2.1 AA on #ffffff bg):
//   fg          #1f2937   13.1:1  ✅ AAA
//   fgMuted     #4b5563    7.6:1  ✅ AAA   (was #6b7280, bumped per a11y review)
//   fgSubtle    #6b7280    4.6:1  ✅ AA    (was #9ca3af, bumped per a11y review)
//   primary     #2563eb    5.2:1  ✅ AA
// =============================================================================

import type { CSSProperties } from "react";

// -----------------------------------------------------------------------------
// Color
// -----------------------------------------------------------------------------
export const color = {
  // Surfaces
  bg:           "#ffffff",
  bgMuted:      "#fafafa",
  bgSubtle:     "#f3f4f6",
  bgRaised:     "#ffffff",

  // Borders
  border:       "#e5e7eb",
  borderStrong: "#d1d5db",
  borderSubtle: "#f3f4f6",

  // Foreground (text)
  fg:           "#1f2937",
  fgMuted:      "#4b5563",
  fgSubtle:     "#6b7280",

  // Brand / interactive
  primary:        "#2563eb",
  primaryFg:      "#ffffff",
  primaryBgSoft:  "#eff6ff",
  primaryFgSoft:  "#1e40af",

  // Semantic
  success:        "#16a34a",
  successFg:      "#ffffff",
  successBgSoft:  "#dcfce7",
  successFgSoft:  "#166534",

  warning:        "#b45309",
  warningBgSoft:  "#fef3c7",
  warningFgSoft:  "#92400e",
  warningBorder:  "#fcd34d",

  danger:         "#dc2626",
  dangerBgSoft:   "#fee2e2",
  dangerFgSoft:   "#991b1b",

  // Status (worklist)
  statusInfoBgSoft: "#dbeafe",
  statusInfoFgSoft: "#1e40af",
} as const;

// -----------------------------------------------------------------------------
// Spacing — 4px scale. Always use these values, never raw numbers.
// -----------------------------------------------------------------------------
export const space = {
  0:  0,
  1:  4,
  2:  8,
  3:  12,
  4:  16,
  5:  24,
  6:  32,
  7:  48,
  8:  64,
} as const;

// -----------------------------------------------------------------------------
// Radii
// -----------------------------------------------------------------------------
export const radius = {
  sm:    4,
  md:    6,
  pill:  12,
  round: "50%",
} as const;

// -----------------------------------------------------------------------------
// Type scale — paired (font-size, line-height, weight).
// -----------------------------------------------------------------------------
export const type = {
  display: { fontSize: 22, fontWeight: 600, lineHeight: 1.2 },
  title:   { fontSize: 18, fontWeight: 600, lineHeight: 1.3 },
  section: { fontSize: 16, fontWeight: 600, lineHeight: 1.4 },
  body:    { fontSize: 13, fontWeight: 400, lineHeight: 1.5 },
  bodyStrong: { fontSize: 13, fontWeight: 600, lineHeight: 1.5 },
  caption: { fontSize: 12, fontWeight: 400, lineHeight: 1.4 },
  micro:   { fontSize: 11, fontWeight: 400, lineHeight: 1.4 },
  eyebrow: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    color: color.fgMuted,
  },
} as const satisfies Record<string, CSSProperties>;

// -----------------------------------------------------------------------------
// Layout
// -----------------------------------------------------------------------------
export const layout = {
  topBarHeight: 48,
  navWidth:     240,
  sidePaneWidth: 340,
  pageMaxWidth: {
    narrow: 720,
    wide:   1280,
  },
} as const;
