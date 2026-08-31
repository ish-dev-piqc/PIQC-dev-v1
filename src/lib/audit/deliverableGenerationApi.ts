import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import type {
  AuditEvidenceListRow,
  DeliverableGenerationRef,
  DeliverableGroundingSnapshot,
} from '../../types/audit';
import type { MockAgendaItem, MockChecklistItem } from './mockPreAudit';

// =============================================================================
// Grounded deliverable generation API (PR-C1 checklist, PR-C2 fan-out).
//
// requestDeliverableDraft calls the consolidated /audit-deliverable-draft edge
// function, which returns a PROPOSAL (content patch + gate-verified refs + the
// grounding it actually retrieved over) and writes nothing.
// applyDeliverableGeneration lands it via the per-deliverable
// audit_mode_apply_*_generation RPC — content through the existing upsert
// (demote-on-edit latch intact), snapshot stamped atomically. The caller
// refetches the bundle afterward; this module never re-implements the read
// path.
//
// Letter rule: recipients (personnel names) never reach the model — the edge
// function drafts body_text + scope only, and THIS module merges the current
// recipients into the applied content.
//
// computeDeliverableCurrency is the flag-never-block set-diff: grounding
// snapshot vs live register. Pure — unit-tested directly.
// =============================================================================

export type DeliverableKind =
  | 'checklist'
  | 'agenda'
  | 'confirmation_letter'
  | 'internal_notification';

export interface DeliverableDraftProposal {
  mode: 'generate' | 'revise';
  deliverable: DeliverableKind;
  // items for items-shaped kinds; body_text + scope for letter-shaped ones.
  content_patch: {
    items?: MockChecklistItem[] | MockAgendaItem[];
    body_text?: string;
    scope?: string[];
  };
  generation_refs: DeliverableGenerationRef[];
  grounding: DeliverableGroundingSnapshot;
  dropped_count: number;
  stripped_ref_count: number;
  protocol_source: 'ready' | 'unavailable';
  evidence_doc_count: number;
}

// Client mirror of the engine's per-kind shape (audit-deliverable-draft
// DELIVERABLES config). Record-typed so a new kind cannot compile without
// declaring its shape — the alternative (a kind-ternary with an items
// fall-through) silently wipes a letter-shaped kind's body on apply.
const KIND_SHAPE: Record<DeliverableKind, 'items' | 'letter'> = {
  checklist: 'items',
  agenda: 'items',
  confirmation_letter: 'letter',
  internal_notification: 'letter',
};

const APPLY_RPC: Record<DeliverableKind, string> = {
  checklist: 'audit_mode_apply_checklist_generation',
  agenda: 'audit_mode_apply_agenda_generation',
  confirmation_letter: 'audit_mode_apply_confirmation_letter_generation',
  internal_notification: 'audit_mode_apply_internal_notification_generation',
};

const DRAFT_NOUN: Record<DeliverableKind, string> = {
  checklist: 'Checklist',
  agenda: 'Agenda',
  confirmation_letter: 'Confirmation letter',
  internal_notification: 'Internal notification',
};

export async function requestDeliverableDraft(
  auditId: string,
  deliverable: DeliverableKind,
): Promise<Result<DeliverableDraftProposal>> {
  const { data: { session } } = await supabase.auth.getSession();
  // Hard fail without a session — generation must never ride the anon key.
  if (!session?.access_token) {
    return { ok: false, error: 'Not signed in — refresh and try again' };
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  // fetch/json can throw outright (network drop, gateway HTML error page) —
  // catch so the Result contract holds and the caller's busy state can't stick.
  let resOk: boolean;
  let payload: (Partial<DeliverableDraftProposal> & { error?: string }) | null;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/audit-deliverable-draft`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audit_id: auditId, deliverable }),
    });
    resOk = res.ok;
    payload = (await res.json()) as typeof payload;
  } catch (e) {
    console.error('[deliverableGenerationApi] requestDeliverableDraft fetch threw:', e);
    return { ok: false, error: 'Drafting failed — check your connection and try again' };
  }

  if (!resOk || !payload || typeof payload.content_patch !== 'object' || payload.content_patch === null) {
    console.error('[deliverableGenerationApi] requestDeliverableDraft error:', payload?.error);
    return { ok: false, error: payload?.error ?? 'Drafting failed' };
  }

  return { ok: true, data: payload as DeliverableDraftProposal };
}

/**
 * Lands an accepted proposal. For the letter, `currentRecipients` is merged
 * into the content here — generation never sees or emits recipients. Returns
 * Result<null>; the caller refetches the bundle via fetchPreAuditDeliverables.
 */
export async function applyDeliverableGeneration(
  auditId: string,
  proposal: DeliverableDraftProposal,
  opts?: { currentRecipients?: string[] },
): Promise<Result<null>> {
  const content =
    KIND_SHAPE[proposal.deliverable] === 'letter'
      ? {
          body_text: proposal.content_patch.body_text ?? '',
          scope: proposal.content_patch.scope ?? [],
          // Recipients exist only on the vendor-facing letter; the internal
          // notification is name-free by design.
          ...(proposal.deliverable === 'confirmation_letter'
            ? { recipients: opts?.currentRecipients ?? [] }
            : {}),
        }
      : { items: proposal.content_patch.items ?? [] };

  const noun = DRAFT_NOUN[proposal.deliverable];
  const { error } = await supabase.rpc(APPLY_RPC[proposal.deliverable], {
    p_audit_id: auditId,
    p_content: content,
    p_generation_refs: proposal.generation_refs,
    p_grounding_snapshot: proposal.grounding,
    p_reason:
      proposal.mode === 'revise'
        ? `${noun} revised by PIQC from protocol + evidence`
        : `${noun} drafted by PIQC from protocol + evidence`,
  });

  if (error) {
    console.error('[deliverableGenerationApi] applyDeliverableGeneration error:', error);
    // The supabase-js shape exposes hint on PostgrestError when present.
    const hint = (error as unknown as { hint?: string }).hint;
    return { ok: false, error: hint ?? error.message };
  }

  return { ok: true, data: null };
}

// -----------------------------------------------------------------------------
// Currency — flag, never block
// -----------------------------------------------------------------------------

export interface DeliverableCurrency {
  newSinceGeneration: Array<{ document_id: string; title: string }>;
  removedSinceGeneration: Array<{ document_id: string; title: string }>;
  isCurrent: boolean;
}

/**
 * Set-diff of the generation's grounding snapshot against the live register.
 * null when the deliverable was never generated (currency has no meaning), so
 * callers can distinguish "current" from "not applicable".
 */
export function computeDeliverableCurrency(
  snapshot: DeliverableGroundingSnapshot | null | undefined,
  liveRegister: AuditEvidenceListRow[],
): DeliverableCurrency | null {
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
