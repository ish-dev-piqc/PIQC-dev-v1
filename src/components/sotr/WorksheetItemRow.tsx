import { FileSearch, Link2 } from 'lucide-react';
import ReviewStatusBadge from './ReviewStatusBadge';
import type { ExtractedItemRecord } from '../../types/sotr';

// One row in the worksheet items list. Renders the extracted value, the
// review-status badge, and a "View Source" action that opens the SOTR
// drawer for this item.
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
  const display = getItemDisplayLabel(item);
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
          className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border bg-white dark:bg-[#0F172A] border-[#E2E8F0] dark:border-white/10 text-fg-body hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04]"
        >
          <FileSearch size={11} />
          View Source
        </button>
        {onPick && (
          <button
            type="button"
            onClick={() => onPick(item)}
            data-testid="sotr-attach-button"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-brand-600 text-white hover:bg-brand-800 dark:bg-brand-300 dark:text-[#0F172A] dark:hover:bg-brand-700"
          >
            <Link2 size={11} />
            Attach
          </button>
        )}
      </div>
    </div>
  );
}

// Single source of truth for "what string should the user see for this
// extracted item" — used by both the worksheet list row AND the SOTR
// drawer header (via WorksheetItemsList). Keeps the visit/non-visit
// branching in one place so they never drift apart again.
export function getItemDisplayLabel(item: ExtractedItemRecord): string {
  if (item.current_text) return item.current_text;
  if (item.field_type === 'visit') return formatVisit(item.extracted_value);
  return formatExtractedValue(item.extracted_value);
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

// Semantic render for the visit object shape Reducto returns in
// schedule_of_events entries: { visit_name, study_day, window_minus_days,
// window_plus_days, procedures, cross_references, schedule_variant }.
// Produces something like:
//   "Randomization — Day 0 (±0d) · 2 procedures"
// Falls back to JSON.stringify when the shape doesn't match.
export function formatVisit(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'object' || Array.isArray(value)) {
    return formatExtractedValue(value);
  }
  const v = value as Record<string, unknown>;
  const name = typeof v.visit_name === 'string' ? v.visit_name.trim() : '';
  const day = typeof v.study_day === 'number' ? v.study_day : null;
  const minus = typeof v.window_minus_days === 'number' ? v.window_minus_days : 0;
  const plus = typeof v.window_plus_days === 'number' ? v.window_plus_days : 0;
  const procs = Array.isArray(v.procedures) ? v.procedures.length : 0;
  const variant = typeof v.schedule_variant === 'string' ? v.schedule_variant.trim() : '';

  // If neither name nor day is present, the row is structurally broken —
  // fall back to JSON so the reader can still see what came through.
  if (!name && day === null) return formatExtractedValue(value);

  const parts: string[] = [];
  if (name) parts.push(name);
  if (day !== null) parts.push(`Day ${day}`);
  const window = minus !== 0 || plus !== 0
    ? `±${Math.max(Math.abs(minus), plus)}d`
    : null;
  const tail: string[] = [];
  if (window) tail.push(window);
  if (procs > 0) tail.push(`${procs} procedure${procs === 1 ? '' : 's'}`);
  if (variant) tail.push(variant);

  const head = parts.join(' — ');
  return tail.length > 0 ? `${head} (${tail.join(' · ')})` : head;
}
