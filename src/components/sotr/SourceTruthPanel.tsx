import { useState } from 'react';
import { ChevronLeft, ChevronRight, FileSearch, AlertTriangle, MapPinOff } from 'lucide-react';
import ConfidenceBadge from './ConfidenceBadge';
import type {
  WorksheetItemSourceEvidence,
  SourceEvidenceForReview,
  MissingSourceReason,
} from '../../types/sotr';

// =============================================================================
// SourceTruthPanel — content of the SOTR drawer.
//
// Shows the worksheet item's confidence + reason, then either a single
// source view (with prev/next nav across multiple sources) or a clear
// needs-review message when the sources array is empty.
//
// No PDF viewer — coordinates absent? Show a "highlight unavailable"
// hint and render the quoted source text + citation metadata only.
// =============================================================================

interface Props {
  /** Optional label for the worksheet item itself (e.g. extracted text). */
  itemLabel?: string | null;
  data: WorksheetItemSourceEvidence;
}

const MISSING_SOURCE_LABELS: Record<MissingSourceReason, string> = {
  parser_output_missing_citation: 'The parser did not provide a citation for this item.',
  source_text_not_found:          'The cited region could not be located in the protocol text.',
  protocol_version_mismatch:      'The cited protocol version does not match the active document.',
  coordinates_unavailable:        'Source coordinates are unavailable.',
  evidence_conflict:              'Conflicting source evidence was detected.',
  unknown:                        'Source evidence is unavailable for an unknown reason.',
};

const SUPPORT_LABELS: Record<SourceEvidenceForReview['support_type'], string> = {
  primary:   'Primary',
  secondary: 'Secondary',
  context:   'Context',
  conflict:  'Conflict',
};

export default function SourceTruthPanel({ itemLabel, data }: Props) {
  const sources = data.sources;
  const [index, setIndex] = useState(0);

  const safeIndex = Math.min(index, Math.max(0, sources.length - 1));
  const current = sources[safeIndex];

  return (
    <div className="space-y-5" data-testid="sotr-panel">
      {/* Worksheet item header */}
      <header>
        <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          Worksheet item
        </p>
        {itemLabel && (
          <p className="text-fg-heading text-sm font-medium mt-1 break-words">
            {itemLabel}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <ConfidenceBadge state={data.confidence_state} size="md" />
          {typeof data.confidence_score === 'number' && (
            <span className="text-fg-muted text-[11px]">
              Score {data.confidence_score.toFixed(2)}
            </span>
          )}
        </div>
        {data.confidence_reason && (
          <p
            data-testid="sotr-confidence-reason"
            className="text-fg-sub text-xs mt-2 leading-relaxed"
          >
            {data.confidence_reason}
          </p>
        )}
        {data.ambiguity_reason && (
          <p className="text-fg-muted text-xs mt-1 leading-relaxed">
            {data.ambiguity_reason}
          </p>
        )}
      </header>

      {/* No-evidence state */}
      {sources.length === 0 ? (
        <NoEvidence reason={data.missing_source_reason} />
      ) : (
        <>
          {/* Source nav */}
          {sources.length > 1 && (
            <SourceNavigator
              count={sources.length}
              index={safeIndex}
              onPrev={() => setIndex((i) => Math.max(0, i - 1))}
              onNext={() => setIndex((i) => Math.min(sources.length - 1, i + 1))}
            />
          )}

          {/* Active source */}
          <SourceCard source={current} />
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// SourceNavigator — prev / next + position counter
// -----------------------------------------------------------------------------

interface NavProps {
  count: number;
  index: number;
  onPrev: () => void;
  onNext: () => void;
}

function SourceNavigator({ count, index, onPrev, onNext }: NavProps) {
  const atStart = index === 0;
  const atEnd = index === count - 1;
  return (
    <div
      data-testid="sotr-source-nav"
      className="flex items-center justify-between"
    >
      <span className="text-fg-sub text-xs font-medium">
        Source {index + 1} of {count}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={atStart}
          aria-label="Previous source"
          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-[#e2e8ee] dark:border-white/10 text-fg-body hover:bg-[#f5f7fa] dark:hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={atEnd}
          aria-label="Next source"
          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-[#e2e8ee] dark:border-white/10 text-fg-body hover:bg-[#f5f7fa] dark:hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SourceCard — citation metadata + quoted source text + missing-coords hint
// -----------------------------------------------------------------------------

function SourceCard({ source }: { source: SourceEvidenceForReview }) {
  const headerParts = [
    source.protocol_version || 'Protocol document',
    source.section_number ? `Section ${source.section_number}` : null,
    source.section_title,
    typeof source.page_number === 'number' ? `Page ${source.page_number}` : null,
    SUPPORT_LABELS[source.support_type],
  ].filter(Boolean);

  const hasCoords = Array.isArray(source.bounding_boxes) && source.bounding_boxes.length > 0;

  return (
    <article
      data-testid="sotr-source-card"
      className="border border-[#e2e8ee] dark:border-white/5 rounded-xl bg-white dark:bg-[#131a22] overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-[#f0f3f6] dark:border-white/[0.04]">
        <p
          data-testid="sotr-source-header"
          className="text-fg-heading text-xs font-semibold leading-relaxed"
        >
          Source: {headerParts.join(' · ')}
        </p>
      </div>

      <div className="px-4 py-3 space-y-3">
        {!hasCoords && (
          <div
            data-testid="sotr-missing-coords"
            className="flex items-start gap-2 text-fg-muted text-[11px] leading-relaxed"
          >
            <MapPinOff size={12} className="flex-shrink-0 mt-0.5" />
            <span>
              Exact highlight unavailable. Showing quoted source text and citation metadata.
            </span>
          </div>
        )}

        {source.source_text ? (
          <blockquote
            data-testid="sotr-quoted-text"
            className="border-l-2 border-[#4a6fa5] dark:border-[#6e8fb5] pl-3 text-fg-body text-sm leading-relaxed whitespace-pre-wrap"
          >
            {source.source_text}
          </blockquote>
        ) : (
          <p className="text-fg-muted text-xs italic">
            Quoted source text was not captured for this citation.
          </p>
        )}
      </div>
    </article>
  );
}

// -----------------------------------------------------------------------------
// NoEvidence — clear "needs review" message + reason if any
// -----------------------------------------------------------------------------

function NoEvidence({ reason }: { reason: MissingSourceReason | null }) {
  return (
    <div
      data-testid="sotr-no-evidence"
      className="border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.06] rounded-xl px-4 py-4"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-amber-800 dark:text-amber-300 text-sm font-medium">
            No reliable source evidence was found for this worksheet item.
          </p>
          <p className="text-amber-700 dark:text-amber-300/80 text-xs leading-relaxed">
            This item needs review before it is used in a draft worksheet.
          </p>
          {reason && (
            <p className="text-amber-700 dark:text-amber-300/80 text-xs leading-relaxed pt-1">
              {MISSING_SOURCE_LABELS[reason]}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Loading + Error scaffolds (used by SourceTruthDrawer)
// -----------------------------------------------------------------------------

export function SourceTruthLoading() {
  return (
    <div
      data-testid="sotr-loading"
      className="flex items-center gap-2 text-fg-sub text-sm"
      role="status"
      aria-live="polite"
    >
      <FileSearch size={14} className="animate-pulse" />
      Loading source evidence…
    </div>
  );
}

interface ErrorProps {
  onRetry: () => void;
}

export function SourceTruthError({ onRetry }: ErrorProps) {
  return (
    <div
      data-testid="sotr-error"
      className="border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/[0.06] rounded-xl px-4 py-4 space-y-3"
      role="alert"
    >
      <p className="text-rose-700 dark:text-rose-300 text-sm font-medium">
        We couldn't load source evidence right now.
      </p>
      <p className="text-rose-700/80 dark:text-rose-300/80 text-xs leading-relaxed">
        Please check your connection and try again. If the problem persists, the
        item may need to be re-parsed.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-100/50 dark:hover:bg-rose-500/[0.10]"
      >
        Try again
      </button>
    </div>
  );
}
