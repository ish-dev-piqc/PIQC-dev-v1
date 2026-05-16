import { Sparkle } from 'lucide-react';

// =============================================================================
// PiqcMark — the PIQC brand icon. Single source of truth for "PIQC's face."
//
// Today: wraps lucide `Sparkle` (singular, focused). `Sparkles` (plural) is
// already in use elsewhere for generic agentic banners (PrefillAgentNote,
// shell's "Risk summary" affordance) — using `Sparkle` here gives PIQC its
// own visual register without competing with those callsites.
//
// Tomorrow: when design ships a custom PIQC mark SVG, swap the import here
// and every callsite (dock, panel header, future surfaces) picks it up
// without touching their layouts. Doctrine: brand iteration shouldn't fan
// out across the codebase.
//
// Color is currentColor by default so callers control the brand treatment
// per surface (warmer on the dock, calmer in the panel header).
// =============================================================================

interface Props {
  size?: number;
  className?: string;
  /** Hide from a11y tree when the surrounding label already names PIQC. */
  ariaHidden?: boolean;
}

export default function PiqcMark({ size = 14, className, ariaHidden = true }: Props) {
  return (
    <Sparkle
      size={size}
      className={className}
      aria-hidden={ariaHidden}
      // Use a stroke + fill combination so PIQC's mark reads as solid at
      // small sizes — pure stroked icons disappear at 12-14px against the
      // glassy dock background.
      fill="currentColor"
      strokeWidth={1.25}
    />
  );
}
