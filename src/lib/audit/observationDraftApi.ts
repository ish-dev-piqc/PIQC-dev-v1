import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import { PROVISIONAL_CLASSIFICATION_ORDER } from './labels';
import type { IsaProtocolRef, ProvisionalClassification } from '../../types/audit';

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
// Every candidate is shape-checked on the way in (response and stash): a
// malformed element is dropped, never rendered — one bad row in storage
// must not take Stage 6 down on every reload.
//
// Result<T>, not throw (the ISA sibling predates the house rule): the panel
// renders the error string as-is, so the strings here are auditor-facing.
// =============================================================================

/** Row facts of a cited evidence passage — no model text. content_hash is the
 *  filed document's version at drafting time. */
export interface CandidatePassageRef {
  chunk_id: string;
  document_id: string;
  content_hash: string | null;
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}

export interface CandidateEvidence {
  text: string;
  source_note_ids: string[];
  source_passages: CandidatePassageRef[];
}

export interface ObservationCandidate {
  vendor_domain: string;
  observation_text: string;
  checkpoint_ref: string | null;
  evidence: CandidateEvidence[];
  /** A verified quote of the audit protocol (post-Gate-3 snapshot) — the
   *  same shape the ISA lane stores. */
  protocol_ref: IsaProtocolRef | null;
}

/** The model/tool half of the provenance contract — recorded on accept. */
export interface DraftingEngine {
  function: string;
  model: string;
}

export interface ObservationDraftResponse {
  candidates: ObservationCandidate[];
  /** Proposals the server withheld because they couldn't be traced to notes or evidence. */
  withheld_count: number;
  /** Protocol citations stripped for failing candidate membership or the verbatim check. */
  stripped_protocol_ref_count: number;
  engine: DraftingEngine;
  drafted_at: string;
}

// ---------------------------------------------------------------------------
// Shape guards
// ---------------------------------------------------------------------------

const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isNumOrNull = (v: unknown): v is number | null => v === null || typeof v === 'number';
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function isPassageRef(v: unknown): v is CandidatePassageRef {
  return (
    isRecord(v) &&
    isStr(v.chunk_id) &&
    isStr(v.document_id) &&
    isStrOrNull(v.content_hash) &&
    isStrOrNull(v.section_heading) &&
    isNumOrNull(v.page_start) &&
    isNumOrNull(v.page_end)
  );
}

function isEvidence(v: unknown): v is CandidateEvidence {
  return (
    isRecord(v) &&
    isStr(v.text) &&
    Array.isArray(v.source_note_ids) &&
    v.source_note_ids.every(isStr) &&
    Array.isArray(v.source_passages) &&
    v.source_passages.every(isPassageRef)
  );
}

function isProtocolRef(v: unknown): v is IsaProtocolRef {
  return (
    isRecord(v) &&
    isStrOrNull(v.chunk_id) &&
    isStrOrNull(v.document_id) &&
    isStr(v.quote) &&
    isStrOrNull(v.section_heading) &&
    isNumOrNull(v.page_start) &&
    isNumOrNull(v.page_end)
  );
}

export function isObservationCandidate(v: unknown): v is ObservationCandidate {
  return (
    isRecord(v) &&
    isStr(v.vendor_domain) &&
    isStr(v.observation_text) &&
    isStrOrNull(v.checkpoint_ref) &&
    Array.isArray(v.evidence) &&
    v.evidence.every(isEvidence) &&
    (v.protocol_ref === null || isProtocolRef(v.protocol_ref))
  );
}

function isEngine(v: unknown): v is DraftingEngine {
  return isRecord(v) && isStr(v.function) && isStr(v.model);
}

// ---------------------------------------------------------------------------
// The drafting request
// ---------------------------------------------------------------------------

export const DRAFTING_ENGINE_NOT_DEPLOYED =
  'The drafting engine is not deployed yet — your notes are safe.';
export const DRAFTING_ENGINE_UNREACHABLE =
  'PIQC could not be reached — your notes are safe. Try again in a moment.';
const DRAFTING_ENGINE_UNREADABLE = 'The drafting engine returned an unreadable response.';

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

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, error: DRAFTING_ENGINE_UNREADABLE };
  }
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.candidates) ||
    !isEngine(payload.engine) ||
    !isStr(payload.drafted_at)
  ) {
    return { ok: false, error: DRAFTING_ENGINE_UNREADABLE };
  }

  return {
    ok: true,
    data: {
      candidates: payload.candidates.filter(isObservationCandidate),
      withheld_count: typeof payload.withheld_count === 'number' ? payload.withheld_count : 0,
      stripped_protocol_ref_count:
        typeof payload.stripped_protocol_ref_count === 'number' ? payload.stripped_protocol_ref_count : 0,
      engine: payload.engine,
      drafted_at: payload.drafted_at,
    },
  };
}

// ============================================================================
// Candidate stash — best-effort crash insurance (ISA's piq-isa-drafts-v1
// precedent), scoped to the signed-in user AND the audit: a shared on-site
// laptop must never hand one auditor's edited candidates to the next.
// Never lets a storage failure break the flow.
// ============================================================================

export const CANDIDATE_STASH_PREFIX = 'piq-vendor-candidates-v1:';

/** The proposal exactly as the engine returned it — the promote RPC derives
 *  origin by comparing the accepted text against this. */
export interface DraftedText {
  vendor_domain: string;
  observation_text: string;
  checkpoint_ref: string | null;
}

/** Candidate plus client-side review state. */
export interface StashedCandidate extends ObservationCandidate {
  /** Client-minted; becomes the promote RPC's idempotency key. */
  key: string;
  drafted: DraftedText;
  /** The auditor's choice — persisted with the card it belongs to. */
  classification: ProvisionalClassification;
  engine: DraftingEngine;
  drafted_at: string;
}

export interface CandidateStash {
  candidates: StashedCandidate[];
  withheld_count: number;
  stripped_protocol_ref_count: number;
}

export const EMPTY_CANDIDATE_STASH: CandidateStash = {
  candidates: [],
  withheld_count: 0,
  stripped_protocol_ref_count: 0,
};

export function stashCandidate(
  candidate: ObservationCandidate,
  engine: DraftingEngine,
  draftedAt: string,
  key: string,
): StashedCandidate {
  return {
    ...candidate,
    key,
    drafted: {
      vendor_domain: candidate.vendor_domain,
      observation_text: candidate.observation_text,
      checkpoint_ref: candidate.checkpoint_ref,
    },
    classification: 'NOT_YET_CLASSIFIED',
    engine,
    drafted_at: draftedAt,
  };
}

/** Same comparison the promote RPC makes (trim-insensitive; a blank
 *  checkpoint equals none) — the "Edited" chip can never disagree with the
 *  origin the server records. Reverting an edit un-edits it. */
export function isCandidateEdited(c: StashedCandidate): boolean {
  return (
    c.vendor_domain.trim() !== c.drafted.vendor_domain.trim() ||
    c.observation_text.trim() !== c.drafted.observation_text.trim() ||
    (c.checkpoint_ref?.trim() || null) !== (c.drafted.checkpoint_ref?.trim() || null)
  );
}

export function candidateStashKey(userId: string, auditId: string): string {
  return `${CANDIDATE_STASH_PREFIX}${userId}:${auditId}`;
}

function isStashedCandidate(v: unknown): v is StashedCandidate {
  if (!isObservationCandidate(v)) return false;
  const c = v as unknown as Record<string, unknown>;
  return (
    isStr(c.key) &&
    isRecord(c.drafted) &&
    isStr(c.drafted.vendor_domain) &&
    isStr(c.drafted.observation_text) &&
    isStrOrNull(c.drafted.checkpoint_ref) &&
    isStr(c.classification) &&
    (PROVISIONAL_CLASSIFICATION_ORDER as readonly string[]).includes(c.classification) &&
    isEngine(c.engine) &&
    isStr(c.drafted_at)
  );
}

export function readCandidateStash(userId: string, auditId: string): CandidateStash | null {
  try {
    const raw = localStorage.getItem(candidateStashKey(userId, auditId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) return null;
    return {
      candidates: parsed.candidates.filter(isStashedCandidate),
      withheld_count: typeof parsed.withheld_count === 'number' ? parsed.withheld_count : 0,
      stripped_protocol_ref_count:
        typeof parsed.stripped_protocol_ref_count === 'number' ? parsed.stripped_protocol_ref_count : 0,
    };
  } catch {
    return null;
  }
}

export function writeCandidateStash(
  userId: string,
  auditId: string,
  stash: CandidateStash | null,
): void {
  try {
    const key = candidateStashKey(userId, auditId);
    if (!stash || stash.candidates.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(stash));
    }
  } catch {
    // Stash is best-effort crash insurance; never let it break the flow.
  }
}
