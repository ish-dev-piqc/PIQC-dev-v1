// =============================================================================
// Divergence domain types — TS mirror of supabase/migrations/
// 20260726000000_protocol_divergences.sql.
//
// A DivergenceRecord is one place where the protocol's two readings (SoA grid
// vs narrative extraction) disagree. PIQC never adjudicates which reading is
// right: the record carries both readings + a what-was-compared detail, and a
// human dispositions it (open → raised_with_sponsor → resolved | dismissed,
// append-only trail). Shared, mode-agnostic types: Site/VEW renders the
// per-visit slice; a future SOTR surface reads the same records protocol-wide.
// Design: plans/fable/narrative-first-worksheet-spec.md §5.5.
// =============================================================================

export type DivergenceClass = 'window_mismatch' | 'presence' | 'cohort_scope';

export type DivergenceStatus = 'open' | 'raised_with_sponsor' | 'resolved' | 'dismissed';

export interface DivergenceReading {
  source: 'soa_grid' | 'narrative';
  /** verbatim=true → protocol text as parsed (e.g. the SoA column header);
   * verbatim=false → an extraction-recorded value, honestly labeled as such. */
  quote: string;
  verbatim: boolean;
  section: string | null;
  page: number | null;
}

/** One append-only lifecycle transition. Resolution annotates, never erases. */
export interface DivergenceDisposition {
  status: DivergenceStatus;
  note: string | null;
  /** auth.uid() of the human who made the transition. */
  actor: string | null;
  /** ISO timestamp. */
  at: string;
}

export interface DivergenceRecord {
  id: string;
  protocol_id: string;
  /** DB column is `class`; renamed here to avoid the reserved-word footgun. */
  divergence_class: DivergenceClass;
  visit_name: string | null;
  procedure_label: string | null;
  reading_a: DivergenceReading; // the SoA grid reading
  reading_b: DivergenceReading; // the narrative reading
  /** What was compared — never a verdict. */
  detail: string;
  status: DivergenceStatus;
  dispositions: DivergenceDisposition[];
  created_at: string;
}

export const DIVERGENCE_CLASS_LABELS: Record<DivergenceClass, string> = {
  window_mismatch: 'Window mismatch',
  presence: 'Presence',
  cohort_scope: 'Cohort scope',
};

export const DIVERGENCE_STATUS_LABELS: Record<DivergenceStatus, string> = {
  open: 'Open',
  raised_with_sponsor: 'Raised with sponsor',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};
