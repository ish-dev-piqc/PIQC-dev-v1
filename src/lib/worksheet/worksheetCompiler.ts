// =============================================================================
// Worksheet Compiler — Sprint 1B
//
// Deterministic builder: reads protocol_visit_templates + documents.extracted_fields
// and emits a WorksheetBundle. No AI inference anywhere in this function.
//
// Deduplication strategy (Q3):
//   - Both Source A (SOA appendix table, window=0) and Source B (inline section
//     headers, window>0) produce entries for the same logical visits.
//   - Source B wins when it has valid window values.
//   - When both sources have non-zero values for the same field but disagree,
//     a DiscrepancyEvent is generated in qa_ledger for human review.
//
// Procedure source (Q5, Sprint 1B):
//   - procedures[] come from protocol_visit_templates.procedures TEXT[] only.
//   - No per-procedure citations in Sprint 1B; deferred to Sprint 1C.
// =============================================================================

import type { ProtocolVisitTemplate } from '../site/types';
import type {
  WorksheetBundle,
  WorksheetCitation,
  MaybeCited,
  SourceDocumentRef,
  ProtocolMetadata,
  ObjectiveEntry,
  EligibilitySection,
  VisitEntry,
  ProcedureEntry,
  QaLedger,
  QaEntry,
  DeduplicationEvent,
  DiscrepancyEvent,
} from './types';

export const COMPILER_VERSION = '1.0.0';

export interface CompilerInput {
  protocolVersionId: string;
  documentId: string;
  documentTitle: string;
  extractedFields: Record<string, unknown> | null;
  visitTemplates: ProtocolVisitTemplate[];
  sourceDocuments: SourceDocumentRef[];
}

// -----------------------------------------------------------------------------
// Safe field accessors
// -----------------------------------------------------------------------------

function getString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function getStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim());
}

function getBoolean(obj: Record<string, unknown>, key: string): boolean {
  return obj[key] === true;
}

// -----------------------------------------------------------------------------
// Citation extraction
// Reducto stores citations separately from values. The exact shape of the
// citations key varies; we extract defensively and fall back to [] when absent.
// Citation population will be confirmed after Q1 (Studio re-run) is verified.
// -----------------------------------------------------------------------------

function extractCitations(
  fields: Record<string, unknown>,
  fieldName: string,
  documentId: string,
  documentTitle: string,
): WorksheetCitation[] {
  const citationsMap = fields['citations'];
  if (!citationsMap || typeof citationsMap !== 'object' || Array.isArray(citationsMap)) {
    return [];
  }
  const fieldCitations = (citationsMap as Record<string, unknown>)[fieldName];
  if (!Array.isArray(fieldCitations)) return [];

  const results: WorksheetCitation[] = [];
  for (const c of fieldCitations) {
    if (!c || typeof c !== 'object') continue;
    const record = c as Record<string, unknown>;
    const bbox = record['bbox'] as Record<string, unknown> | undefined;
    const page = bbox ? (bbox['original_page'] ?? bbox['page']) : null;
    if (typeof page !== 'number') continue;

    results.push({
      document_id: documentId,
      document_title: documentTitle,
      page,
      bbox: bbox
        ? {
            left: Number(bbox['left'] ?? 0),
            top: Number(bbox['top'] ?? 0),
            width: Number(bbox['width'] ?? 0),
            height: Number(bbox['height'] ?? 0),
          }
        : undefined,
      section_heading: null,
      chunk_preview: typeof record['content'] === 'string' ? record['content'] : '',
      confidence:
        record['confidence'] === 'high'
          ? 'high'
          : record['confidence'] === 'low'
            ? 'low'
            : 'unverified',
      extract_confidence:
        typeof (record['granular_confidence'] as Record<string, unknown> | null)
          ?.['extract_confidence'] === 'number'
          ? ((record['granular_confidence'] as Record<string, unknown>)['extract_confidence'] as number)
          : null,
    });
  }
  return results;
}

// -----------------------------------------------------------------------------
// Deduplication
// -----------------------------------------------------------------------------

interface RawVisitEntry {
  visit_name: string;
  study_day: number;
  window_minus_days: number;
  window_plus_days: number;
  schedule_variant: string | null;
}

interface DeduplicationResult {
  visit_name: string;
  study_day: number;
  window_minus_days: number;
  window_plus_days: number;
  schedule_variant: string | null;
  winning_source: DeduplicationEvent['winning_source'];
  dedup_event: DeduplicationEvent;
  discrepancy_events: DiscrepancyEvent[];
}

function normalizeVisitName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseRawSchedule(fields: Record<string, unknown>): RawVisitEntry[] {
  const raw = fields['schedule_of_events'];
  if (!Array.isArray(raw)) return [];

  const results: RawVisitEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const name = String(record['visit_name'] ?? '').trim();
    if (!name) continue;

    const schedVariant = typeof record['schedule_variant'] === 'string'
      ? record['schedule_variant'].trim() || null
      : null;

    results.push({
      visit_name: name,
      study_day: Number(record['study_day'] ?? 0),
      window_minus_days: Number(record['window_minus_days'] ?? 0),
      window_plus_days: Number(record['window_plus_days'] ?? 0),
      schedule_variant: schedVariant,
    });
  }
  return results;
}

function deduplicateVisits(rawEntries: RawVisitEntry[]): DeduplicationResult[] {
  // Group by normalized visit name
  const groups = new Map<string, RawVisitEntry[]>();
  for (const entry of rawEntries) {
    const key = normalizeVisitName(entry.visit_name);
    const existing = groups.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  const results: DeduplicationResult[] = [];

  for (const [, entries] of groups) {
    // Classify: has-windows = Source B (inline section header), no-windows = Source A (SOA table)
    const hasWindows = entries.filter(e => e.window_minus_days > 0 || e.window_plus_days > 0);
    const noWindows = entries.filter(e => e.window_minus_days === 0 && e.window_plus_days === 0);

    let winner: RawVisitEntry;
    let winningSource: DeduplicationEvent['winning_source'];
    const discrepancyEvents: DiscrepancyEvent[] = [];

    if (hasWindows.length > 0) {
      winner = hasWindows[0];
      winningSource = 'inline_section';

      // Cross-check all other entries against the winner
      for (const other of entries) {
        if (other === winner) continue;

        // study_day discrepancy: both have non-zero study days that differ
        if (other.study_day !== 0 && winner.study_day !== 0 && other.study_day !== winner.study_day) {
          discrepancyEvents.push({
            visit_name: winner.visit_name,
            field: 'study_day',
            source_a_value: other.study_day,
            source_b_value: winner.study_day,
            winning_value: winner.study_day,
            context: `SOA table says study_day=${other.study_day}; inline section says study_day=${winner.study_day}. Used inline section (higher confidence).`,
          });
        }

        // window_minus_days discrepancy: both have non-zero values that differ
        if (other.window_minus_days > 0 && other.window_minus_days !== winner.window_minus_days) {
          discrepancyEvents.push({
            visit_name: winner.visit_name,
            field: 'window_minus_days',
            source_a_value: other.window_minus_days,
            source_b_value: winner.window_minus_days,
            winning_value: winner.window_minus_days,
            context: `Both sources specify window_minus_days but disagree: SOA table=${other.window_minus_days}, inline section=${winner.window_minus_days}. Used inline section.`,
          });
        }

        // window_plus_days discrepancy: both have non-zero values that differ
        if (other.window_plus_days > 0 && other.window_plus_days !== winner.window_plus_days) {
          discrepancyEvents.push({
            visit_name: winner.visit_name,
            field: 'window_plus_days',
            source_a_value: other.window_plus_days,
            source_b_value: winner.window_plus_days,
            winning_value: winner.window_plus_days,
            context: `Both sources specify window_plus_days but disagree: SOA table=${other.window_plus_days}, inline section=${winner.window_plus_days}. Used inline section.`,
          });
        }
      }
    } else {
      // Only Source A entries — use the first one
      winner = noWindows[0];
      winningSource = 'soa_table';
    }

    // Preserve schedule_variant from any entry in the group
    const scheduleVariant = entries.find(e => e.schedule_variant)?.schedule_variant ?? null;

    const sourcesDescription =
      hasWindows.length > 0 && noWindows.length > 0
        ? `${entries.length} entries found: ${hasWindows.length} with valid windows (inline sections), ${noWindows.length} with window=0 (SOA table). Preferred inline section source.`
        : entries.length > 1
          ? `${entries.length} entries found from the same source type. Used first entry.`
          : `Single entry — no deduplication needed.`;

    results.push({
      visit_name: winner.visit_name,
      study_day: winner.study_day,
      window_minus_days: winner.window_minus_days,
      window_plus_days: winner.window_plus_days,
      schedule_variant: scheduleVariant,
      winning_source: winningSource,
      dedup_event: {
        visit_name: winner.visit_name,
        sources_found: entries.length,
        winning_source: winningSource,
        reason: sourcesDescription,
      },
      discrepancy_events: discrepancyEvents,
    });
  }

  return results;
}

// -----------------------------------------------------------------------------
// Main compiler
// -----------------------------------------------------------------------------

export function compileWorksheet(input: CompilerInput): WorksheetBundle {
  const { protocolVersionId, documentId, documentTitle, extractedFields, visitTemplates, sourceDocuments } = input;
  const now = new Date().toISOString();

  const missingFields: QaEntry[] = [];
  const lowConfidenceFields: QaEntry[] = [];
  const deduplicationEvents: DeduplicationEvent[] = [];
  const discrepancyEvents: DiscrepancyEvent[] = [];

  const fields = extractedFields ?? {};

  // Records a missing field in qa_ledger and returns the null MaybeCited variant.
  function notFound(
    fieldPath: string,
    source: string,
    recoverable = true,
  ): { value: null; reason: string; expected_source: string } {
    missingFields.push({
      field_path: fieldPath,
      reason: 'not_found_in_extract',
      expected_source: source,
      recoverable,
    });
    return { value: null, reason: 'not_found_in_extract', expected_source: source };
  }

  // --- Protocol metadata ---

  const titleVal = getString(fields, 'protocol_title');
  const title: MaybeCited<string> = titleVal
    ? { value: titleVal, citations: extractCitations(fields, 'protocol_title', documentId, documentTitle) }
    : notFound('protocol.title', 'documents.extracted_fields.protocol_title', false);

  const studyNumberVal = getString(fields, 'protocol_number');
  const study_number: MaybeCited<string> = studyNumberVal
    ? { value: studyNumberVal, citations: extractCitations(fields, 'protocol_number', documentId, documentTitle) }
    : notFound('protocol.study_number', 'documents.extracted_fields.protocol_number', false);

  const sponsorVal = getString(fields, 'sponsor_name');
  const sponsor_name: MaybeCited<string> = sponsorVal
    ? { value: sponsorVal, citations: extractCitations(fields, 'sponsor_name', documentId, documentTitle) }
    : notFound('protocol.sponsor_name', 'documents.extracted_fields.sponsor_name');

  const phaseVal = getString(fields, 'study_phase');
  const study_phase: MaybeCited<string> = phaseVal
    ? { value: phaseVal, citations: extractCitations(fields, 'study_phase', documentId, documentTitle) }
    : notFound('protocol.study_phase', 'documents.extracted_fields.study_phase');

  const is_amendment = getBoolean(fields, 'is_amendment');
  const amendmentSummaryVal = getString(fields, 'amendment_summary');
  const amendment_summary: MaybeCited<string | null> = {
    value: amendmentSummaryVal,
    citations: amendmentSummaryVal
      ? extractCitations(fields, 'amendment_summary', documentId, documentTitle)
      : [],
  };

  const protocol: ProtocolMetadata = {
    title,
    study_number,
    sponsor_name,
    study_phase,
    is_amendment,
    amendment_summary,
  };

  // --- Objectives ---

  const primaryTexts = getStringArray(fields, 'primary_endpoints');
  const secondaryTexts = getStringArray(fields, 'secondary_endpoints');

  if (primaryTexts.length === 0 && secondaryTexts.length === 0) {
    notFound('objectives', 'documents.extracted_fields.primary_endpoints', false);
  }

  const objectives: ObjectiveEntry[] = [
    ...primaryTexts.map((text): ObjectiveEntry => ({
      text: { value: text, citations: [] },
      objective_type: 'primary',
      // tier linked in Sprint 1C via protocol_risk_objects
      tier: { value: null, citations: [] },
    })),
    ...secondaryTexts.map((text): ObjectiveEntry => ({
      text: { value: text, citations: [] },
      objective_type: 'secondary',
      tier: { value: null, citations: [] },
    })),
  ];

  // --- Eligibility ---

  const inclusionTexts = getStringArray(fields, 'key_inclusion_criteria');
  const exclusionTexts = getStringArray(fields, 'key_exclusion_criteria');

  if (inclusionTexts.length === 0) {
    notFound('eligibility.inclusion', 'documents.extracted_fields.key_inclusion_criteria');
  }
  if (exclusionTexts.length === 0) {
    notFound('eligibility.exclusion', 'documents.extracted_fields.key_exclusion_criteria');
  }

  const eligibility: EligibilitySection = {
    inclusion: inclusionTexts.map(t => ({ value: t, citations: [] as WorksheetCitation[] })),
    exclusion: exclusionTexts.map(t => ({ value: t, citations: [] as WorksheetCitation[] })),
  };

  // --- Visits ---

  // Template map for procedure lookup (Q5: procedures from templates only in Sprint 1B)
  const templateMap = new Map(
    visitTemplates.map(t => [normalizeVisitName(t.visit_name), t])
  );

  const rawEntries = parseRawSchedule(fields);
  let visits: VisitEntry[];

  if (rawEntries.length > 0) {
    const deduped = deduplicateVisits(rawEntries);

    deduplicationEvents.push(...deduped.map(d => d.dedup_event));
    discrepancyEvents.push(...deduped.flatMap(d => d.discrepancy_events));

    visits = deduped.map((d): VisitEntry => {
      const template = templateMap.get(normalizeVisitName(d.visit_name));

      const procedures: ProcedureEntry[] = (template?.procedures ?? []).map(label => ({
        label,
        criticality_ref: null,  // linked in Sprint 1C
        citations: [],          // chunk-level citations deferred to Sprint 1C
      }));

      if (!template) {
        notFound(
          `visits[${d.visit_name}].procedures`,
          'protocol_visit_templates.procedures',
          true,
        );
      }

      // Flag window=0 when the only source was the SOA table — these are unreliable
      if (d.winning_source === 'soa_table' && d.window_minus_days === 0 && d.window_plus_days === 0) {
        lowConfidenceFields.push({
          field_path: `visits[${d.visit_name}].window_*_days`,
          reason: 'Only SOA table source found; window values may be 0 due to merged-cell parsing limitation rather than a genuine no-window specification.',
          expected_source: 'Inline visit section header (e.g. "Visit N (Week X, Day Y±Z)")',
          recoverable: true,
        });
      }

      return {
        visit_name: { value: d.visit_name, citations: [] },
        study_day: { value: d.study_day, citations: [] },
        window_minus_days: { value: d.window_minus_days, citations: [] },
        window_plus_days: { value: d.window_plus_days, citations: [] },
        schedule_variant: d.schedule_variant,
        procedures,
        source_document_id: template?.source_document_id ?? documentId,
      };
    });
  } else {
    // No raw schedule_of_events — build entirely from protocol_visit_templates
    deduplicationEvents.push({
      visit_name: '(all)',
      sources_found: 0,
      winning_source: 'template_only',
      reason: 'schedule_of_events absent from extracted_fields — visits built from protocol_visit_templates only.',
    });

    if (visitTemplates.length === 0) {
      notFound('visits', 'protocol_visit_templates + documents.extracted_fields.schedule_of_events', false);
    } else {
      missingFields.push({
        field_path: 'visits[].window_*_days',
        reason: 'schedule_of_events not found in extracted_fields — window values sourced from template only, no cross-check possible',
        expected_source: 'documents.extracted_fields.schedule_of_events',
        recoverable: true,
      });
    }

    visits = visitTemplates.map((t): VisitEntry => ({
      visit_name: { value: t.visit_name, citations: [] },
      study_day: { value: t.study_day, citations: [] },
      window_minus_days: { value: t.window_minus_days, citations: [] },
      window_plus_days: { value: t.window_plus_days, citations: [] },
      schedule_variant: null,
      procedures: t.procedures.map(label => ({ label, criticality_ref: null, citations: [] })),
      source_document_id: t.source_document_id,
    }));
  }

  const qa_ledger: QaLedger = {
    missing_fields: missingFields,
    low_confidence_fields: lowConfidenceFields,
    deduplication_events: deduplicationEvents,
    discrepancy_events: discrepancyEvents,
  };

  return {
    bundle_version: '1.0',
    protocol_version_id: protocolVersionId,
    compiled_at: now,
    compiler_version: COMPILER_VERSION,
    source_documents: sourceDocuments,
    protocol,
    objectives,
    eligibility,
    visits,
    qa_ledger,
  };
}
