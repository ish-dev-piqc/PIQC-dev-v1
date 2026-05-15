import { FileSearch, Link2 } from 'lucide-react';
import ConfidenceBadge from './ConfidenceBadge';
import ReviewStatusBadge from './ReviewStatusBadge';
import type { ExtractedItemRecord } from '../../types/sotr';

// One row in the worksheet items list. Renders the extracted value, the
// confidence badge + reason (if any), and a "View Source" action that
// opens the SOTR drawer for this item.
//
// When `onPick` is provided (picker workflows — e.g. Stage 1 risk → source
// link), an additional "Attach" affordance appears next to View Source.
// Default row click behaviour is unchanged — auditors can still inspect
// before picking.

interface Props {
  item: ExtractedItemRecord;
  onViewSource: (item: ExtractedItemRecord) => void;
  onPick?: (item: ExtractedItemRecord) => void;
}

export default function WorksheetItemRow({ item, onViewSource, onPick }: Props) {
  // Edited current_text takes precedence over the parser output for display.
  const display = item.current_text ?? formatExtractedValue(item.extracted_value);
  return (
    <div
      data-testid="sotr-worksheet-item-row"
      data-item-id={item.id}
      className="px-5 py-3.5 flex items-start gap-4 flex-wrap"
    >
      <div className="flex-1 min-w-0">
        <p
          data-testid="sotr-worksheet-item-value"
          className="text-fg-heading text-sm font-medium break-words"
        >
          {display}
        </p>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <ConfidenceBadge state={item.confidence_state} />
          <ReviewStatusBadge status={item.review_status} />
          <span className="text-fg-muted text-[10px] uppercase tracking-wider font-semibold">
            {item.field_type}
          </span>
        </div>
        {item.confidence_reason && (
          <p
            data-testid="sotr-worksheet-item-reason"
            className="text-fg-sub text-xs mt-1.5 leading-relaxed"
          >
            {item.confidence_reason}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={() => onViewSource(item)}
          data-testid="sotr-view-source-button"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border bg-white dark:bg-[#131a22] border-[#e2e8ee] dark:border-white/10 text-fg-body hover:bg-[#f5f7fa] dark:hover:bg-white/[0.04]"
        >
          <FileSearch size={11} />
          View Source
        </button>
        {onPick && (
          <button
            type="button"
            onClick={() => onPick(item)}
            data-testid="sotr-attach-button"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-[#4a6fa5] text-white hover:bg-[#3d5e8f] dark:bg-[#6e8fb5] dark:text-[#1a1f28] dark:hover:bg-[#5e7fa5]"
          >
            <Link2 size={11} />
            Attach
          </button>
        )}
      </div>
    </div>
  );
}

// Best-effort label for the JSONB extracted_value. Strings + numbers render
// as-is; objects/arrays fall back to JSON. Truncated upstream by CSS only —
// readers want to see the full value in this list.
export function formatExtractedValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string')   return value;
  if (typeof value === 'number')   return String(value);
  if (typeof value === 'boolean')  return value ? 'true' : 'false';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
