// =============================================================================
// divergenceAdapter — pure row → DivergenceRecord mapper (no supabase import,
// per the adapters-are-pure rule). Defensive on every field: a malformed row
// returns null rather than a partially-typed record.
// =============================================================================

import type {
  DivergenceClass,
  DivergenceDisposition,
  DivergenceReading,
  DivergenceRecord,
  DivergenceStatus,
} from '../../types/divergence';

const CLASSES: readonly DivergenceClass[] = ['window_mismatch', 'presence', 'cohort_scope'];
const STATUSES: readonly DivergenceStatus[] = ['open', 'raised_with_sponsor', 'resolved', 'dismissed'];

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function adaptReading(v: unknown): DivergenceReading | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const source = r.source === 'soa_grid' || r.source === 'narrative' ? r.source : null;
  const quote = typeof r.quote === 'string' ? r.quote : null;
  if (!source || quote === null) return null;
  return {
    source,
    quote,
    verbatim: r.verbatim === true,
    section: str(r.section),
    page: typeof r.page === 'number' ? Math.trunc(r.page) : null,
  };
}

function adaptDispositions(v: unknown): DivergenceDisposition[] {
  if (!Array.isArray(v)) return [];
  const out: DivergenceDisposition[] = [];
  for (const d of v) {
    if (!d || typeof d !== 'object') continue;
    const r = d as Record<string, unknown>;
    const status = STATUSES.find((s) => s === r.status);
    if (!status || typeof r.at !== 'string') continue;
    out.push({ status, note: str(r.note), actor: str(r.actor), at: r.at });
  }
  return out;
}

export function adaptDivergenceRow(row: unknown): DivergenceRecord | null {
  if (!row || typeof row === 'string') return null;
  const r = row as Record<string, unknown>;
  const divergenceClass = CLASSES.find((c) => c === r.class);
  const status = STATUSES.find((s) => s === r.status);
  const readingA = adaptReading(r.reading_a);
  const readingB = adaptReading(r.reading_b);
  if (
    typeof r.id !== 'string' ||
    typeof r.protocol_id !== 'string' ||
    !divergenceClass ||
    !status ||
    !readingA ||
    !readingB ||
    typeof r.detail !== 'string'
  ) {
    return null;
  }
  return {
    id: r.id,
    protocol_id: r.protocol_id,
    divergence_class: divergenceClass,
    visit_name: str(r.visit_name),
    procedure_label: str(r.procedure_label),
    reading_a: readingA,
    reading_b: readingB,
    detail: r.detail,
    status,
    dispositions: adaptDispositions(r.dispositions),
    created_at: typeof r.created_at === 'string' ? r.created_at : '',
  };
}

const STATUS_RANK: Record<DivergenceStatus, number> = {
  open: 0,
  raised_with_sponsor: 1,
  resolved: 2,
  dismissed: 3,
};
const CLASS_RANK: Record<DivergenceClass, number> = {
  window_mismatch: 0,
  presence: 1,
  cohort_scope: 2,
};

/** Open work first, then by class consequence, then stable by visit/label. */
export function sortDivergences(records: DivergenceRecord[]): DivergenceRecord[] {
  return [...records].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      CLASS_RANK[a.divergence_class] - CLASS_RANK[b.divergence_class] ||
      (a.visit_name ?? '').localeCompare(b.visit_name ?? '') ||
      (a.procedure_label ?? '').localeCompare(b.procedure_label ?? ''),
  );
}
