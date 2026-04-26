// =============================================================================
// Breadcrumb — page-level navigation trail. Last item is the current page
// (rendered as plain text); preceding items are links.
//
// Server component. Uses Next.js Link for client-side navigation on prior
// crumbs.
// =============================================================================

import Link from "next/link";
import type { CSSProperties } from "react";
import { color, space } from "@/lib/ui/tokens";

export interface Crumb {
  label: string;
  href?: string; // Last crumb omits href (current page)
}

interface Props {
  items: Crumb[];
}

export function Breadcrumb({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" style={navStyle}>
      <ol style={listStyle}>
        {items.map((crumb, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${crumb.label}-${idx}`} style={itemStyle}>
              {crumb.href && !isLast ? (
                <Link href={crumb.href} style={linkStyle}>
                  {crumb.label}
                </Link>
              ) : (
                <span style={currentStyle} aria-current={isLast ? "page" : undefined}>
                  {crumb.label}
                </span>
              )}
              {!isLast && (
                <span aria-hidden="true" style={separatorStyle}>
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const navStyle: CSSProperties = {
  fontSize: 13,
};

const listStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: space[2],
  listStyle: "none",
  margin: 0,
  padding: 0,
  flexWrap: "wrap",
};

const itemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: space[2],
};

const linkStyle: CSSProperties = {
  color: color.fgMuted,
  textDecoration: "none",
};

const currentStyle: CSSProperties = {
  color: color.fg,
  fontWeight: 500,
};

const separatorStyle: CSSProperties = {
  color: color.fgSubtle,
};
