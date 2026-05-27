import { Download } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// ExportPlaceholderButton — disabled affordance with a tooltip that makes
// PIQC's draft-only stance honest. No export logic runs. The button exists
// so the workflow shape is visible; the copy makes it clear that final
// approval lives outside PIQC.
//
// Polish-v2 (2026-05-27): aligned to the canonical primary-button disabled
// state shared by RequirementTextDrawer's save button and (post-#137)
// CompletenessSignalsPanel's Add button — one button-system across the
// whole workspace so the workflow shape reads as designed rather than ad-hoc.
// =============================================================================

export default function ExportPlaceholderButton() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    <div className="inline-block group relative">
      <button
        type="button"
        disabled
        aria-disabled="true"
        data-testid="vew-export-placeholder"
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold cursor-not-allowed ${
          isLight
            ? 'bg-[#cbd2db] text-white'
            : 'bg-white/10 text-fg-muted'
        }`}
      >
        <Download size={12} aria-hidden />
        Export draft
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute right-0 top-full mt-2 w-72 text-[11px] leading-relaxed px-3 py-2 rounded-md border shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 z-20 ${
          isLight
            ? 'bg-white border-[#e2e8ee] text-[#374152]'
            : 'bg-[#131a22] border-white/10 text-[#d2d7e0]'
        }`}
      >
        All PIQC output is draft-ready and requires final review and approval
        outside PIQC. Export available in a future release.
      </span>
    </div>
  );
}
