import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import type {
  IsaDomain,
  IsaFindingEvidence,
  IsaFindingObject,
  IsaFindingOrigin,
  IsaProtocolRef,
  IsaResponseOwner,
  IsaSeverity,
} from '../../types/audit';

// =============================================================================
// ISA findings API — isa_finding_objects CRUD + the finding-draft LLM call.
//
// Mutations route through Postgres RPCs in
// supabase/migrations/20260724000100_audit_mode_isa_findings_rpcs.sql; each
// writes a state_history_delta atomically and re-validates the evidence chain
// (every cited note must be live on the same audit). No delete — findings are
// append-only.
//
// requestIsaFindingDrafts calls the isa-finding-draft edge function under the
// user's JWT (same shape as reportApi's requestLlmSection). The function
// returns PROPOSALS only — nothing persists until the auditor accepts a draft
// via createIsaFinding (D-008). Drafts arrive post-gate: every evidence item
// traces to real note ids, and `reference` is either a citation-map string or
// null.
// =============================================================================

export async function fetchIsaFindings(auditId: string): Promise<Result<IsaFindingObject[]>> {
  const { data, error } = await supabase
    .from('isa_finding_objects')
    .select('*')
    .eq('audit_id', auditId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[isaFindingsApi] fetchIsaFindings error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []) as IsaFindingObject[] };
}

export interface CreateIsaFindingInput {
  title: string;
  isaDomain: IsaDomain;
  severity: IsaSeverity;
  observation: string;
  evidence: IsaFindingEvidence[];
  origin: IsaFindingOrigin;
  subcategory?: string | null;
  severityRule?: string | null;
  reference?: string | null;
  responseOwner?: IsaResponseOwner;
  protocolRefs?: IsaProtocolRef[];
}

export async function createIsaFinding(
  auditId: string,
  input: CreateIsaFindingInput,
): Promise<Result<IsaFindingObject>> {
  const { data, error } = await supabase.rpc('audit_mode_create_isa_finding', {
    p_audit_id: auditId,
    p_title: input.title,
    p_isa_domain: input.isaDomain,
    p_severity: input.severity,
    p_observation: input.observation,
    p_evidence: input.evidence,
    p_origin: input.origin,
    p_subcategory: input.subcategory ?? null,
    p_severity_rule: input.severityRule ?? null,
    p_reference: input.reference ?? null,
    p_response_owner: input.responseOwner ?? 'SITE',
    p_protocol_refs: input.protocolRefs ?? [],
  });

  if (error) {
    console.error('[isaFindingsApi] createIsaFinding error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: data as IsaFindingObject };
}

export interface UpdateIsaFindingInput {
  title?: string;
  isaDomain?: IsaDomain;
  subcategory?: string;
  clearSubcategory?: boolean;
  severity?: IsaSeverity;
  severityRule?: string;
  clearSeverityRule?: boolean;
  observation?: string;
  evidence?: IsaFindingEvidence[];
  reference?: string;
  clearReference?: boolean;
  responseOwner?: IsaResponseOwner;
  /** Full replacement; pass [] to clear. Omit to leave unchanged. */
  protocolRefs?: IsaProtocolRef[];
}

export async function updateIsaFinding(
  findingId: string,
  input: UpdateIsaFindingInput,
): Promise<Result<IsaFindingObject>> {
  const { data, error } = await supabase.rpc('audit_mode_update_isa_finding', {
    p_id: findingId,
    p_title: input.title ?? null,
    p_isa_domain: input.isaDomain ?? null,
    p_subcategory: input.subcategory ?? null,
    p_clear_subcategory: input.clearSubcategory ?? false,
    p_severity: input.severity ?? null,
    p_severity_rule: input.severityRule ?? null,
    p_clear_severity_rule: input.clearSeverityRule ?? false,
    p_observation: input.observation ?? null,
    p_evidence: input.evidence ?? null,
    p_reference: input.reference ?? null,
    p_clear_reference: input.clearReference ?? false,
    p_response_owner: input.responseOwner ?? null,
    p_protocol_refs: input.protocolRefs ?? null,
  });

  if (error) {
    console.error('[isaFindingsApi] updateIsaFinding error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: data as IsaFindingObject };
}

// ============================================================================
// LLM finding drafts (edge function isa-finding-draft)
// ============================================================================

/** One post-gate draft proposal from the edge function. */
export interface IsaFindingDraft {
  title: string;
  isa_domain: IsaDomain;
  subcategory: string | null;
  severity: IsaSeverity;
  severity_rule: string | null;
  observation: string;
  evidence: IsaFindingEvidence[];
  reference: string | null;
  /** Proposed protocol citation — post-Gate-3, quote verified verbatim. */
  protocol_ref: IsaProtocolRef | null;
}

export interface IsaFindingDraftResponse {
  drafts: IsaFindingDraft[];
  /** Proposals the server withheld because they couldn't be traced to notes. */
  withheld_count: number;
  /** References stripped for being outside the closed citation map. */
  stripped_reference_count: number;
  /** Protocol citations stripped for failing candidate membership or the
   *  verbatim-quote check (Gate 3). */
  stripped_protocol_ref_count: number;
  /** Whether the audit's protocol has ready parsed documents to cite. */
  protocol_source: 'ready' | 'unavailable';
  note_count: number;
}

export class IsaFindingDraftError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'IsaFindingDraftError';
    this.status = status;
  }
}

export async function requestIsaFindingDrafts(
  auditId: string,
  noteIds?: string[],
): Promise<IsaFindingDraftResponse> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? supabaseAnonKey;

  const res = await fetch(`${supabaseUrl}/functions/v1/isa-finding-draft`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      noteIds && noteIds.length > 0
        ? { audit_id: auditId, note_ids: noteIds }
        : { audit_id: auditId },
    ),
  });

  if (!res.ok) {
    let message = 'Finding drafting failed';
    try {
      const payload = await res.json();
      if (typeof payload?.error === 'string') message = payload.error;
    } catch {
      // keep the generic message
    }
    throw new IsaFindingDraftError(message, res.status);
  }

  return (await res.json()) as IsaFindingDraftResponse;
}

// ============================================================================
// Protocol-citation bridge (S4) — manual picker search + availability signal.
//
// Both RPCs are SECURITY DEFINER behind a lead_auditor_id gate: chunk RLS is
// owner-only and the auditor is usually not the document uploader, so the
// client cannot query chunks directly. The search only ever returns chunks
// of THIS audit's protocol's ready documents.
// ============================================================================

/** One search hit from the audit protocol's parsed documents. */
export interface IsaProtocolChunkHit {
  chunk_id: string;
  document_id: string;
  snippet: string;
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}

export async function searchIsaProtocolChunks(
  auditId: string,
  query: string,
  limit = 8,
): Promise<Result<IsaProtocolChunkHit[]>> {
  const { data, error } = await supabase.rpc('audit_mode_search_isa_protocol_chunks', {
    p_audit_id: auditId,
    p_query: query,
    p_limit: limit,
  });

  if (error) {
    console.error('[isaFindingsApi] searchIsaProtocolChunks error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []) as IsaProtocolChunkHit[] };
}

/** Ready parsed-document count for the audit's protocol. 0 → bridge hidden. */
export async function fetchIsaProtocolBridgeStatus(
  auditId: string,
): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('audit_mode_isa_protocol_bridge_status', {
    p_audit_id: auditId,
  });

  if (error) {
    console.error('[isaFindingsApi] fetchIsaProtocolBridgeStatus error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? 0) as number };
}
