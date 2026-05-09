import { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { listWorksheetItemsForStudy } from '../../lib/sotr/sourceEvidenceApi';
import type { ExtractedItemRecord } from '../../types/sotr';
import WorksheetItemRow from './WorksheetItemRow';
import SourceTruthDrawer from './SourceTruthDrawer';
import DownloadDraftPacketButton from './DownloadDraftPacketButton';
import { formatExtractedValue } from './WorksheetItemRow';

// Fetches worksheet items for a study, groups by field_type, and renders
// each row with a confidence badge + "View Source" action that opens
// SourceTruthDrawer.

interface Props {
  studyId: string;
  /** Optional human-friendly study code used in the export filename. */
  studyCode?: string | null;
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  endpoint:            'Endpoints',
  inclusion_criterion: 'Inclusion criteria',
  exclusion_criterion: 'Exclusion criteria',
  visit:               'Visits',
  dosing:              'Dosing',
  metadata:            'Protocol metadata',
  other:               'Other',
};

export default function WorksheetItemsList({ studyId, studyCode }: Props) {
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

  return (
    <div
      data-testid="sotr-worksheet-items-list"
      className="bg-white dark:bg-[#131a22] border border-[#e2e8ee] dark:border-white/5 rounded-xl overflow-hidden"
    >
      <div className="px-5 py-3.5 border-b border-[#f0f3f6] dark:border-white/[0.04] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ListChecks size={14} className="text-fg-muted" />
          <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
            Parsed protocol items
          </p>
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
        <p className="px-5 py-8 text-center text-fg-sub text-sm leading-relaxed max-w-md mx-auto">
          No worksheet items have been generated for this protocol yet. Upload
          a protocol PDF to extract draft items.
        </p>
      )}

      {!loading && !error && items.length > 0 && (
        <Grouped items={items} onViewSource={setActive} />
      )}

      {active && (
        <SourceTruthDrawer
          studyId={studyId}
          worksheetItemId={active.id}
          itemLabel={formatExtractedValue(active.extracted_value)}
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
}

function Grouped({ items, onViewSource }: GroupedProps) {
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
          <header className="px-5 py-2 bg-[#f5f7fa] dark:bg-white/[0.02] border-b border-[#f0f3f6] dark:border-white/[0.04]">
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              {FIELD_TYPE_LABELS[fieldType] ?? fieldType}
              <span className="ml-2 text-fg-muted normal-case font-normal tracking-normal">
                {rows.length}
              </span>
            </p>
          </header>
          <div className="divide-y divide-[#f0f3f6] dark:divide-white/[0.04]">
            {rows.map((row) => (
              <WorksheetItemRow
                key={row.id}
                item={row}
                onViewSource={onViewSource}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
