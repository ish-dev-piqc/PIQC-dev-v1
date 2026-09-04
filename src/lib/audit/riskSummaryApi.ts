import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import { OPERATIONAL_DOMAIN_OPTIONS } from './labels';
import type { TaggedSection } from './mockProtocolRisks';
import type {
  MockProtocolRiskRef,
  MockRiskSummary,
} from './mockRiskSummary';
import type {
  ClinicalTrialPhase,
  RiskSummaryApprovalStatus,
  RiskSummaryStudyContext,
} from '../../types/audit';

// =============================================================================
// Risk Summary (Stage 4) API
//
// Reads: direct SELECT against vendor_risk_summary_objects + junction.
// Writes: RPCs in supabase/migrations/20260430160000_audit_mode_risk_summary_rpcs.sql.
// =============================================================================

interface RiskSummaryRow {
  id: string;
  audit_id: string;
  study_context: RiskSummaryStudyContext;
  vendor_relevance_narrative: string;
  focus_areas: string[];
  approval_status: RiskSummaryApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

async function flattenRiskSummary(row: RiskSummaryRow): Promise<MockRiskSummary> {
  let approvedByName: string | null = null;
  if (row.approved_by) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('name')
      .eq('id', row.approved_by)
      .maybeSingle();
    approvedByName = (profile as { name?: string } | null)?.name ?? null;
  }

  // Junction → protocol risk refs (display only). Supabase returns the
  // joined object as an array even for many-to-one; flatten and dedupe.
  const { data: junction } = await supabase
    .from('vendor_risk_summary_protocol_risks')
    .select('protocol_risk_objects(id, section_identifier, section_title, operational_domain_tag)')
    .eq('risk_summary_id', row.id);

  const protocolRiskRefs: MockProtocolRiskRef[] = ((junction ?? []) as unknown as Array<{
    protocol_risk_objects: MockProtocolRiskRef | MockProtocolRiskRef[] | null;
  }>)
    .flatMap((j) => {
      const v = j.protocol_risk_objects;
      if (!v) return [];
      return Array.isArray(v) ? v : [v];
    });

  return {
    id: row.id,
    audit_id: row.audit_id,
    study_context: row.study_context,
    vendor_relevance_narrative: row.vendor_relevance_narrative,
    focus_areas: row.focus_areas,
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: approvedByName,
    protocol_risk_refs: protocolRiskRefs,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchRiskSummary(auditId: string): Promise<MockRiskSummary | null> {
  const { data, error } = await supabase
    .from('vendor_risk_summary_objects')
    .select('*')
    .eq('audit_id', auditId)
    .maybeSingle();

  if (error) {
    console.error('[riskSummaryApi] fetchRiskSummary error:', error);
    return null;
  }
  if (!data) return null;

  return flattenRiskSummary(data as RiskSummaryRow);
}

export async function upsertRiskSummary(
  auditId: string,
  patch: {
    study_context?: RiskSummaryStudyContext;
    vendor_relevance_narrative?: string;
    focus_areas?: string[];
  },
  reason?: string
): Promise<MockRiskSummary | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_risk_summary', {
    p_audit_id: auditId,
    p_study_context: patch.study_context ?? null,
    p_narrative: patch.vendor_relevance_narrative ?? null,
    p_focus_areas: patch.focus_areas ?? null,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[riskSummaryApi] upsertRiskSummary error:', error);
    return null;
  }

  return flattenRiskSummary(data as RiskSummaryRow);
}

/** Result for the risk-summary readiness-latch approval. On failure
 *  `errorHint` carries MISSING_EXPECTED_VERSION | STALE_CONTENT when present. */
export type RiskSummaryApproveResult =
  | { ok: true; data: MockRiskSummary }
  | { ok: false; error: string; errorHint?: string };

export async function approveRiskSummary(
  summaryId: string,
  expectedUpdatedAt: string,
  reason?: string
): Promise<RiskSummaryApproveResult> {
  const { data, error } = await supabase.rpc('audit_mode_approve_risk_summary', {
    p_id: summaryId,
    p_reason: reason ?? null,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    console.error('[riskSummaryApi] approveRiskSummary error:', error);
    return {
      ok: false,
      error: error.message,
      errorHint: (error as unknown as { hint?: string }).hint,
    };
  }

  return { ok: true, data: await flattenRiskSummary(data as RiskSummaryRow) };
}

// =============================================================================
// Generate from protocol — inputs for the panel's generate action.
//
// The study-context snapshot is captured from the audit protocol's most recent
// READY document (documents.extracted_fields: the Reducto cover-page
// extraction). Reads are RLS-scoped — own documents, and from 20260912000000
// the documents of protocols the caller leads an audit on. No row is an honest
// null, not an error. The narrative is never generated here: PIQC captures
// facts from the document; the auditor writes why the vendor matters.
// =============================================================================

export interface ParsedStudyContext {
  context: RiskSummaryStudyContext;
  source_document_id: string;
}

export async function fetchParsedStudyContext(
  protocolId: string,
  phase: ClinicalTrialPhase,
): Promise<Result<ParsedStudyContext | null>> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, extracted_fields')
    .eq('protocol_id', protocolId)
    .eq('kind', 'PROTOCOL')
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, data: null };
  const row = data as { id: string; extracted_fields: unknown };
  return {
    ok: true,
    data: {
      context: buildStudyContext(row.extracted_fields, phase, row.id, new Date().toISOString()),
      source_document_id: row.id,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanString).filter((v) => v.length > 0);
}

/**
 * Pure. Keys per the Reducto extraction schema (ingestPipeline.ts, the
 * CLINICAL_EXTRACT_SCHEMA properties). Junk is dropped, never guessed. The
 * phase is the audit's pinned version phase — authoritative over the PDF's
 * free-text study_phase. sponsor_name is deliberately not read (the summary is
 * sponsor-name-free by rule).
 */
export function buildStudyContext(
  extracted: unknown,
  phase: ClinicalTrialPhase,
  documentId: string,
  capturedAt: string,
): RiskSummaryStudyContext {
  const fields = isRecord(extracted) ? extracted : {};
  return {
    therapeutic_space: cleanString(fields.therapeutic_area),
    primary_endpoints: cleanStrings(fields.primary_endpoints),
    secondary_endpoints: cleanStrings(fields.secondary_endpoints),
    clinical_trial_phase: phase,
    captured_at: capturedAt,
    source: 'parsed_document',
    source_document_id: documentId,
  };
}

/** The honest empty when no parsed document exists yet — never a 'TBD' string. */
export function manualStudyContext(
  phase: ClinicalTrialPhase,
  capturedAt: string,
): RiskSummaryStudyContext {
  return {
    therapeutic_space: '',
    primary_endpoints: [],
    secondary_endpoints: [],
    clinical_trial_phase: phase,
    captured_at: capturedAt,
    source: 'manual',
    source_document_id: null,
  };
}

/**
 * Pure. Focus areas seeded from the tagged risks' operational domains — the
 * human labels, deduped, alphabetical. A domain value outside the vocabulary
 * (drift) falls back to the raw value so nothing is silently dropped. These
 * feed Stage-5 prefill (20260515020000: letter scope, agenda topics) and the
 * deliverable drafter's scope areas.
 */
export function focusAreasFromRisks(
  risks: ReadonlyArray<Pick<TaggedSection, 'operational_domain_tag'>>,
): string[] {
  const labels = new Set<string>();
  for (const risk of risks) {
    const tag = risk.operational_domain_tag;
    if (!tag) continue;
    labels.add(OPERATIONAL_DOMAIN_OPTIONS.find((o) => o.value === tag)?.label ?? tag);
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}

/**
 * First src/ caller of audit_mode_link_protocol_risk_to_summary
 * (20260430160000; demote-on-link semantics 20260827000100). Sequential so a
 * failure reports exactly how far it got; the RPC's `false` (already linked)
 * counts as linked — the goal is the set, not the write.
 */
export async function linkProtocolRisksToSummary(
  summaryId: string,
  riskIds: readonly string[],
  reason?: string,
): Promise<Result<{ linked: number }>> {
  let linked = 0;
  for (const riskId of riskIds) {
    const { error } = await supabase.rpc('audit_mode_link_protocol_risk_to_summary', {
      p_summary_id: summaryId,
      p_protocol_risk_id: riskId,
      p_reason: reason ?? null,
    });
    if (error) {
      return { ok: false, error: `${error.message} (${linked} of ${riskIds.length} linked)` };
    }
    linked += 1;
  }
  return { ok: true, data: { linked } };
}
