import { AlertOctagon, AlertTriangle } from 'lucide-react';
import type { SiteVisitConfidence } from '../../../lib/site/types';

// =============================================================================
// VisitConfidenceChip — site-local extraction-confidence indicator for visit
// rows. Mirrors the Polish-v2 "rare-loud" discipline used across the app: only
// the attention-worthy states (low / needs_review) render a chip; high/medium
// stay silent so the chip means "look here". Kept site-local on purpose — the
// VEW VisitConfidenceBadge can't be imported across modes.
//
// Fed by SiteVisit.confidenceState, which is inherited at ingest from the
// matching SOTR visit extracted_item — the SAME confidence the Protocol tab
// shows. NULL/high/medium → renders nothing.
// =============================================================================

interface Props {
  confidence?: SiteVisitConfidence;
  className?: string;
}

export default function VisitConfidenceChip({ confidence, className }: Props) {
  if (confidence !== 'low' && confidence !== 'needs_review') return null;

  const isNeedsReview = confidence === 'needs_review';
  const Icon = isNeedsReview ? AlertOctagon : AlertTriangle;
  const label = isNeedsReview ? 'Needs review' : 'Low confidence';
  const tone = isNeedsReview
    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/[0.08] dark:text-rose-300'
    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/[0.08] dark:text-amber-300';

  return (
    <span
      data-testid="visit-confidence-chip"
      data-confidence={confidence}
      title={
        isNeedsReview
          ? "PIQC couldn't establish confidence on this visit's extraction — verify against the protocol."
          : "Low confidence in this visit's extraction — review against the protocol."
      }
      className={`inline-flex items-center gap-1 text-[10px] font-medium rounded-full border px-1.5 py-0.5 ${tone} ${className ?? ''}`}
    >
      <Icon size={10} aria-hidden />
      {label}
    </span>
  );
}
