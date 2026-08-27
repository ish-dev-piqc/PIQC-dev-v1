import { useEffect, useMemo, useState } from 'react';
import { ListChecks, CheckCircle2 } from 'lucide-react';
import { isAwaitingReview, listWorksheetItemsForStudy } from '../../lib/sotr/sourceEvidenceApi';
import type { ExtractedItemRecord } from '../../types/sotr';
import WorksheetItemRow from './WorksheetItemRow';
import SourceTruthDrawer from './SourceTruthDrawer';
import DownloadDraftPacketButton from './DownloadDraftPacketButton';
import { getItemDisplayLabel } from './WorksheetItemRow';

// Fetches worksheet items for a study, groups by field_type, and renders
// each row with a confidence badge + "View Source" action that opens
// SourceTruthDrawer.

interface Props {
  studyId: string;
  /** Optional human-friendly study code used in the export filename. */
  studyCode?: string | null;
  /** When provided, each row renders an "Attach" affordance for picker workflows. */
  onPick?: (item: ExtractedItemRecord) => void;
  /** Overrides the default empty-state copy — e.g. Audit Mode's ownership-aware message. */
  emptyStateMessage?: string;
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  endpoint:            'Endpoints',
  inclusion_criterion: 'Inclusion criteria',
  exclusion_criterion: 'Exclusion criteria',
  prohibited_med:      'Prohibited medications',
  visit:               'Visits',
  dosing:              'Dosing',
  metadata:            'Protocol metadata',
  other:               'Other',
};

export default function WorksheetItemsList({ studyId, studyCode, onPick, emptyStateMessage }: Props) {
  const [items, setItems] = useState<ExtractedItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ExtractedItemRecord | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Show the spinner only on first load, not on review-triggered refreshes.
    if (refreshToken === 0) setLoading(true);
    setError(null);
    listWorksheetItemsForStudy(studyId)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('We could not load worksheet items right now.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studyId, refreshToken]);

  // F-2: shared predicate with countWorksheetItemsForStudy — single source
  // of truth so the shell badge and this inline count never disagree.
  const awaitingCount = useMemo(
    () => items.filter(isAwaitingReview).length,
    [items],
  );
  const allReviewed = items.length > 0 && awaitingCount === 0;

  return (
    <div
      data-testid="sotr-worksheet-items-list"
      className="bg-white dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-white/5 rounded-xl overflow-hidden"
    >
      <div className="px-5 py-3.5 border-b border-[#F2F2F2] dark:border-white/[0.04] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ListChecks size={14} className="text-fg-muted" />
          <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
            Parsed protocol items
          </p>
          {/* Inline awaiting-review chip. Mirrors the shell badge so the
              auditor sees the same number after opening the drawer. */}
          {awaitingCount > 0 && (
            <span
              data-testid="sotr-worksheet-items-awaiting-count"
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/[0.08] dark:text-amber-300"
            >
              {awaitingCount} awaiting review
            </span>
          )}
          {allReviewed && (
            <span
              data-testid="sotr-worksheet-items-all-reviewed"
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/[0.08] dark:text-emerald-300"
            >
              <CheckCircle2 size={10} />
              All reviewed
            </span>
          )}
        </div>
        <DownloadDraftPacketButton studyId={studyId} studyCode={studyCode} />
      </div>

      {loading && (
        <p
          data-testid="sotr-list-loading"
          className="px-5 py-8 text-center text-fg-sub text-sm"
        >
          Loading worksheet items…
        </p>
      )}

      {error && !loading && (
        <p
          data-testid="sotr-list-error"
          className="px-5 py-8 text-center text-rose-600 dark:text-rose-400 text-sm"
        >
          {error}
        </p>
      )}

      {!loading && !error && items.length === 0 && (
        <p
          data-testid="sotr-list-empty"
          className="px-5 py-8 text-center text-fg-sub text-sm leading-relaxed max-w-md mx-auto"
        >
          {emptyStateMessage ?? (
            <>
              No worksheet items have been generated for this protocol yet. Upload
              a protocol PDF to extract draft items.
            </>
          )}
        </p>
      )}

      {!loading && !error && items.length > 0 && (
        <Grouped items={items} onViewSource={setActive} onPick={onPick} />
      )}

      {active && (
        <SourceTruthDrawer
          studyId={studyId}
          worksheetItemId={active.id}
          itemLabel={getItemDisplayLabel(active)}
          onClose={() => setActive(null)}
          onReviewActionCompleted={() => setRefreshToken((n) => n + 1)}
        />
      )}
    </div>
  );
}

interface GroupedProps {
  items: ExtractedItemRecord[];
  onViewSource: (item: ExtractedItemRecord) => void;
  onPick?: (item: ExtractedItemRecord) => void;
}

function Grouped({ items, onViewSource, onPick }: GroupedProps) {
  const groups = new Map<string, ExtractedItemRecord[]>();
  for (const item of items) {
    const key = item.field_type;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return (
    <>
      {Array.from(groups.entries()).map(([fieldType, rows]) => (
        <section key={fieldType} data-field-type={fieldType}>
          <header className="px-5 py-2 bg-[#F8FAFC] dark:bg-white/[0.02] border-b border-[#F2F2F2] dark:border-white/[0.04]">
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              {FIELD_TYPE_LABELS[fieldType] ?? fieldType}
              <span className="ml-2 text-fg-muted normal-case font-normal tracking-normal">
                {rows.length}
              </span>
            </p>
          </header>
          <div className="divide-y divide-[#F2F2F2] dark:divide-white/[0.04]">
            {rows.map((row) => (
              <WorksheetItemRow
                key={row.id}
                item={row}
                onViewSource={onViewSource}
                onPick={onPick}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
