// =============================================================================
// Badge — small status pill. Single component for Approved / Draft /
// Not started / Status (workflow) / Info — replaces three near-identical
// inline implementations across the app.
//
// Tone palette pulled from tokens; never accept raw colors as props (forces
// new tones to be added here, keeping the visual vocabulary tight).
// =============================================================================

import type { CSSProperties } from "react";
import { color, radius, space } from "@/lib/ui/tokens";

export type BadgeTone =
  | "approved"   // green soft — explicit human approval
  | "draft"      // amber soft — in progress, not yet approved
  | "danger"     // red soft — critical finding / destructive state
  | "neutral"    // gray soft — inactive / not started
  | "info"       // blue soft — informational / in flight
  | "muted";     // very subtle — closed / archived

interface Props {
  tone: BadgeTone;
  children: React.ReactNode;
  style?: CSSProperties;
}

export function Badge({ tone, children, style }: Props) {
  return (
    <span style={{ ...badgeBaseStyle, ...TONE_STYLES[tone], ...style }}>
      {children}
    </span>
  );
}

const badgeBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: 11,
  fontWeight: 500,
  padding: `1px ${space[2]}px`,
  borderRadius: radius.pill,
  whiteSpace: "nowrap",
};

const TONE_STYLES: Record<BadgeTone, CSSProperties> = {
  approved: { background: color.successBgSoft,    color: color.successFgSoft },
  draft:    { background: color.warningBgSoft,    color: color.warningFgSoft },
  danger:   { background: color.dangerBgSoft,     color: color.dangerFgSoft },
  neutral:  { background: color.bgSubtle,         color: color.fgMuted },
  info:     { background: color.statusInfoBgSoft, color: color.statusInfoFgSoft },
  muted:    { background: color.border,           color: color.fgSubtle },
};
