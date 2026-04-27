// =============================================================================
// TopBar — global app chrome. Wordmark + primary nav. No per-page state.
//
// Sits above all routes. Per-page breadcrumbs render inside the page body so
// they can be data-driven (e.g. "Audits / NCT-12345 — ACME Central Lab")
// without coupling the layout to route data.
// =============================================================================

import Link from "next/link";
import type { CSSProperties } from "react";
import { color, layout, space } from "@/lib/ui/tokens";

export function TopBar() {
  return (
    <header style={headerStyle}>
      <div style={innerStyle}>
        <Link href="/audits" style={wordmarkStyle}>
          Vendor PIQC
        </Link>

        <nav aria-label="Primary" style={navStyle}>
          <Link href="/audits" style={navLinkStyle}>
            Audits
          </Link>
        </nav>

        {/* User slot — populated when auth lands. Reserved space prevents
            chrome reflow on auth integration. */}
        <div style={spacerStyle} aria-hidden="true" />
      </div>
    </header>
  );
}

const headerStyle: CSSProperties = {
  height: layout.topBarHeight,
  borderBottom: `1px solid ${color.border}`,
  background: color.bg,
  flexShrink: 0,
};

const innerStyle: CSSProperties = {
  height: "100%",
  maxWidth: layout.pageMaxWidth.wide,
  margin: "0 auto",
  padding: `0 ${space[5]}px`,
  display: "flex",
  alignItems: "center",
  gap: space[5],
};

const wordmarkStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: color.fg,
  letterSpacing: -0.2,
};

const navStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: space[4],
  flex: 1,
};

const navLinkStyle: CSSProperties = {
  fontSize: 13,
  color: color.fgMuted,
};

const spacerStyle: CSSProperties = {
  width: 0,
};
