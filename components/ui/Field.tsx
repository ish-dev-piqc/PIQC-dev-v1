// =============================================================================
// Field — vertical label + optional hint + child input.
//
// Used by all forms in the app. Replaces ad-hoc `<label>` + `<span>` blocks.
// Children are the bare input/select/textarea — wire your own onChange.
// =============================================================================

import type { CSSProperties } from "react";
import { color, space, type as typeScale } from "@/lib/ui/tokens";

interface Props {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function Field({ label, hint, htmlFor, required, children }: Props) {
  // We use <label> as the wrapper so clicking the label focuses the input.
  // If `htmlFor` is provided, fall back to label+id (use when the input is
  // wrapped in additional structure that breaks default association).
  const Outer = htmlFor ? "div" : "label";

  return (
    <Outer style={fieldStyle}>
      {htmlFor ? (
        <label htmlFor={htmlFor} style={labelStyle}>
          {label}{required && <span style={{ color: "#dc2626", marginLeft: 2 }}>*</span>}
        </label>
      ) : (
        <span style={labelStyle}>
          {label}{required && <span style={{ color: "#dc2626", marginLeft: 2 }}>*</span>}
        </span>
      )}
      {hint && <span style={hintStyle}>{hint}</span>}
      {children}
    </Outer>
  );
}

// Standard input/select styling — exported so consumers don't re-author it.
export const inputStyle: CSSProperties = {
  padding: `${space[2]}px ${space[3]}px`,
  fontSize: 13,
  fontFamily: "inherit",
  border: `1px solid ${color.borderStrong}`,
  borderRadius: 4,
  boxSizing: "border-box",
  background: color.bg,
  color: color.fg,
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: space[1],
};

const labelStyle: CSSProperties = {
  ...typeScale.eyebrow,
};

const hintStyle: CSSProperties = {
  fontSize: 12,
  color: color.fgMuted,
};
