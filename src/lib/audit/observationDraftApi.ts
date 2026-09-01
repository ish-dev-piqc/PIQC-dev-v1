import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';

// =============================================================================
// Candidate-observation drafting API (fieldwork lane, slice 2) — the client
// of the audit-observation-draft edge function, plus the localStorage stash
// that keeps an evening of review alive across a reload.
//
// The function returns PROPOSALS only: nothing persists until the auditor
// accepts a candidate via workspaceEntriesApi.promoteWorkspaceCandidate.
// Candidates arrive post-gate — every evidence item traces to live note ids
// and/or retrieved evidence passages, and any protocol quote is verified
// verbatim. There is no severity or classification field on a candidate, by
// schema (the auditor classifies at accept time).
//
// Result<T>, not throw (the ISA sibling predates the house rule): the panel
// renders the error string as-is, so the strings here are auditor-facing.
// =============================================================================

/** Row facts of a cited evidence passage — no model text. */
export interface CandidatePassageRef {
  chunk_id: string;
  document_id: string;
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}

export interface CandidateEvidence {
  text: string;
  source_note_ids: string[];
  source_passages: CandidatePassageRef[];
}

/** A verified quote of the audit protocol (post-Gate-3 snapshot). */
export interface CandidateProtocolRef {
  chunk_id: string;
  document_id: string;
  quote: string;
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}

export interface ObservationCandidate {
  vendor_domain: string;
  observation_text: string;
  checkpoint_ref: string | null;
  evidence: CandidateEvidence[];
  protocol_ref: CandidateProtocolRef | null;
}

export interface ObservationDraftResponse {
  candidates: ObservationCandidate[];
  /** Proposals the server withheld because they couldn't be traced to notes or evidence. */
  withheld_count: number;
  /** Protocol citations stripped for failing candidate membership or the verbatim check. */
  stripped_protocol_ref_count: number;
  protocol_source: 'ready' | 'unavailable';
  note_count: number;
  evidence_doc_count: number;
}

export const DRAFTING_ENGINE_NOT_DEPLOYED =
  'The drafting engine is not deployed yet — your notes are safe.';
export const DRAFTING_ENGINE_UNREACHABLE =
  'PIQC could not be reached — your notes are safe. Try again in a moment.';

export async function requestObservationCandidates(
  auditId: string,
): Promise<Result<ObservationDraftResponse>> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? supabaseAnonKey;

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/audit-observation-draft`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audit_id: auditId }),
    });
  } catch {
    return { ok: false, error: DRAFTING_ENGINE_UNREACHABLE };
  }

  if (!res.ok) {
    let serverMessage: string | null = null;
    try {
      const payload = (await res.json()) as { error?: unknown };
      if (typeof payload?.error === 'string') serverMessage = payload.error;
    } catch {
      // no usable body — fall through to the status mapping
    }
    // The function's own errors always carry `error`. A 404 without one is
    // the platform saying the function does not exist — i.e. not deployed.
    if (serverMessage) return { ok: false, error: serverMessage };
    if (res.status === 404) return { ok: false, error: DRAFTING_ENGINE_NOT_DEPLOYED };
    return { ok: false, error: `Drafting failed (HTTP ${res.status}).` };
  }

  let payload: Partial<ObservationDraftResponse>;
  try {
    payload = (await res.json()) as Partial<ObservationDraftResponse>;
  } catch {
    return { ok: false, error: 'The drafting engine returned an unreadable response.' };
  }
  if (!Array.isArray(payload.candidates)) {
    return { ok: false, error: 'The drafting engine returned an unreadable response.' };
  }

  return {
    ok: true,
    data: {
      candidates: payload.candidates,
      withheld_count: payload.withheld_count ?? 0,
      stripped_protocol_ref_count: payload.stripped_protocol_ref_count ?? 0,
      protocol_source: payload.protocol_source === 'ready' ? 'ready' : 'unavailable',
      note_count: payload.note_count ?? 0,
      evidence_doc_count: payload.evidence_doc_count ?? 0,
    },
  };
}

// ============================================================================
// Candidate stash — best-effort crash insurance (ISA's piq-isa-drafts-v1
// precedent). Never lets a storage failure break the flow.
// ============================================================================

export const CANDIDATE_STASH_PREFIX = 'piq-vendor-candidates-v1:';

/** Candidate plus client-side review state. */
export interface StashedCandidate extends ObservationCandidate {
  key: string;
  /** true once the auditor edits any field — accept then records PIQC_EDITED. */
  dirty: boolean;
}

export interface CandidateStash {
  candidates: StashedCandidate[];
  withheld_count: number;
  stripped_protocol_ref_count: number;
}

export function readCandidateStash(auditId: string): CandidateStash | null {
  try {
    const raw = localStorage.getItem(CANDIDATE_STASH_PREFIX + auditId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CandidateStash>;
    if (!Array.isArray(parsed.candidates)) return null;
    return {
      candidates: parsed.candidates,
      withheld_count: parsed.withheld_count ?? 0,
      stripped_protocol_ref_count: parsed.stripped_protocol_ref_count ?? 0,
    };
  } catch {
    return null;
  }
}

export function writeCandidateStash(auditId: string, stash: CandidateStash | null): void {
  try {
    if (!stash || stash.candidates.length === 0) {
      localStorage.removeItem(CANDIDATE_STASH_PREFIX + auditId);
    } else {
      localStorage.setItem(CANDIDATE_STASH_PREFIX + auditId, JSON.stringify(stash));
    }
  } catch {
    // Stash is best-effort crash insurance; never let it break the flow.
  }
}
