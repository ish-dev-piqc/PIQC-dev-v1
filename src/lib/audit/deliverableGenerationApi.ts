import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import type {
  AuditEvidenceListRow,
  ChecklistGenerationRef,
  ChecklistGroundingSnapshot,
} from '../../types/audit';
import type { MockChecklistItem } from './mockPreAudit';

// =============================================================================
// Grounded deliverable generation API (PR-C1 — checklist slice).
//
// requestChecklistDraft calls the /audit-checklist-draft edge function, which
// returns a PROPOSAL (items + gate-verified refs + the grounding it actually
// retrieved over) and writes nothing. applyChecklistGeneration lands the
// proposal via audit_mode_apply_checklist_generation — content through the
// existing upsert (demote-on-edit latch intact), snapshot stamped atomically.
// The caller refetches the bundle afterward; this module never re-implements
// the read path.
//
// computeChecklistCurrency is the flag-never-block set-diff: grounding
// snapshot vs live register. Pure — unit-tested directly.
// =============================================================================

export interface ChecklistDraftProposal {
  mode: 'generate' | 'revise';
  items: MockChecklistItem[];
  generation_refs: ChecklistGenerationRef[];
  grounding: ChecklistGroundingSnapshot;
  dropped_count: number;
  stripped_ref_count: number;
  protocol_source: 'ready' | 'unavailable';
  evidence_doc_count: number;
}

export async function requestChecklistDraft(
  auditId: string,
): Promise<Result<ChecklistDraftProposal>> {
  const { data: { session } } = await supabase.auth.getSession();
  // Hard fail without a session — generation must never ride the anon key.
  if (!session?.access_token) {
    return { ok: false, error: 'Not signed in — refresh and try again' };
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  // fetch/json can throw outright (network drop, gateway HTML error page) —
  // catch so the Result contract holds and the caller's busy state can't stick.
  let resOk: boolean;
  let payload: (Partial<ChecklistDraftProposal> & { error?: string }) | null;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/audit-checklist-draft`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audit_id: auditId }),
    });
    resOk = res.ok;
    payload = (await res.json()) as typeof payload;
  } catch (e) {
    console.error('[deliverableGenerationApi] requestChecklistDraft fetch threw:', e);
    return { ok: false, error: 'Drafting failed — check your connection and try again' };
  }

  if (!resOk || !payload || !Array.isArray(payload.items)) {
    console.error('[deliverableGenerationApi] requestChecklistDraft error:', payload?.error);
    return { ok: false, error: payload?.error ?? 'Drafting failed' };
  }

  return { ok: true, data: payload as ChecklistDraftProposal };
}

/**
 * Lands an accepted proposal. Returns Result<null>; the caller refetches the
 * bundle via the existing fetchPreAuditDeliverables read path — one mapper,
 * one source of truth for what a checklist row looks like client-side.
 */
export async function applyChecklistGeneration(
  auditId: string,
  proposal: ChecklistDraftProposal,
): Promise<Result<null>> {
  const { error } = await supabase.rpc('audit_mode_apply_checklist_generation', {
    p_audit_id: auditId,
    p_content: { items: proposal.items },
    p_generation_refs: proposal.generation_refs,
    p_grounding_snapshot: proposal.grounding,
    p_reason:
      proposal.mode === 'revise'
        ? 'Checklist revised by PIQC from protocol + evidence'
        : 'Checklist drafted by PIQC from protocol + evidence',
  });

  if (error) {
    console.error('[deliverableGenerationApi] applyChecklistGeneration error:', error);
    // The supabase-js shape exposes hint on PostgrestError when present.
    const hint = (error as unknown as { hint?: string }).hint;
    return { ok: false, error: hint ?? error.message };
  }

  return { ok: true, data: null };
}

// -----------------------------------------------------------------------------
// Currency — flag, never block
// -----------------------------------------------------------------------------

export interface ChecklistCurrency {
  newSinceGeneration: Array<{ document_id: string; title: string }>;
  removedSinceGeneration: Array<{ document_id: string; title: string }>;
  isCurrent: boolean;
}

/**
 * Set-diff of the generation's grounding snapshot against the live register.
 * null when the checklist was never generated (currency has no meaning), so
 * callers can distinguish "current" from "not applicable".
 */
export function computeChecklistCurrency(
  snapshot: ChecklistGroundingSnapshot | null | undefined,
  liveRegister: AuditEvidenceListRow[],
): ChecklistCurrency | null {
  if (!snapshot) return null;

  const included = liveRegister.filter((r) => r.include_in_generation);
  const snapshotIds = new Set(snapshot.evidence.map((e) => e.document_id));
  const liveIds = new Set(included.map((r) => r.document_id));

  const newSinceGeneration = included
    .filter((r) => !snapshotIds.has(r.document_id))
    .map((r) => ({ document_id: r.document_id, title: r.title }));
  const removedSinceGeneration = snapshot.evidence
    .filter((e) => !liveIds.has(e.document_id))
    .map((e) => ({ document_id: e.document_id, title: e.title }));

  return {
    newSinceGeneration,
    removedSinceGeneration,
    isCurrent: newSinceGeneration.length === 0 && removedSinceGeneration.length === 0,
  };
}
