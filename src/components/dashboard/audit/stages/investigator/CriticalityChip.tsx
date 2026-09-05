import { DERIVED_CRITICALITY_LABELS } from '../../../../../lib/audit/labels';
import type { DerivedCriticality } from '../../../../../types/audit';

// =============================================================================
// CriticalityChip — the derived-criticality tier as a chip, on the ISA
// surfaces (Stage 2 module mappings, Stage 3 scope). Same tones as the
// vendor lane's ServiceMappingTable so a criticality reads the same on both
// workflows; that table keeps its own copy (ledgered — consolidating it is
// a vendor-lane touch).
// =============================================================================

export default function CriticalityChip({
  criticality,
  isLight,
}: {
  criticality: DerivedCriticality;
  isLight: boolean;
}) {
  const tones: Record<DerivedCriticality, string> = {
    CRITICAL: isLight
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-red-500/15 border-red-500/30 text-red-300',
    HIGH: isLight
      ? 'bg-orange-50 border-orange-200 text-orange-700'
      : 'bg-orange-500/15 border-orange-500/30 text-orange-300',
    MODERATE: isLight
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    LOW: isLight
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
  };
  return (
    <span
      className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${tones[criticality]}`}
    >
      {DERIVED_CRITICALITY_LABELS[criticality]}
    </span>
  );
}
