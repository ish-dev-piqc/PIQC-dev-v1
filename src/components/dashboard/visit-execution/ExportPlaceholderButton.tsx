import { Download } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// ExportPlaceholderButton — disabled affordance with a tooltip that makes
// PIQC's draft-only stance honest. No export logic runs. The button exists
// so the workflow shape is visible; the copy makes it clear that final
// approval lives outside PIQC.
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
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold border cursor-not-allowed opacity-60 ${
          isLight
            ? 'text-[#374152] border-[#cbd2db] bg-white'
            : 'text-[#d2d7e0] border-white/10 bg-[#131a22]'
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
