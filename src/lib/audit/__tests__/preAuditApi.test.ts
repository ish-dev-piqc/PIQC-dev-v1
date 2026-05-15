// Unit tests for Stage 5 (Pre-Audit Drafting) prefill API wrappers.
//
// Covers the API-layer of the prefill idempotency triple-layering:
//   Layer 1 (this file): server 23505 swallow per individual RPC + the
//                        combined wrapper's best-effort Promise.all
//   Layer 2 (component): attemptedPrefillRef dedup in workspace components
//   Layer 3 (banner):    PrefillAgentNote storageKey re-sync on prop change
//
// The 23505 swallow is the critical clinical-trial invariant: if a prefill
// row already exists, the RPC raises a unique-constraint error and the
// wrapper MUST treat that as a no-op (idempotent on absence). Anything
// else (permission, network, schema) MUST be logged and surfaced to the
// auditor as "deliverable stayed empty — author manually."
//
// Pattern matches src/lib/sotr/__tests__/sourceEvidenceApi.test.ts and
// src/lib/audit/__tests__/intakeApi.test.ts (PR #64).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  prefillConfirmationLetter,
  prefillAgenda,
  prefillChecklist,
  prefillStage5Deliverables,
} from '../preAuditApi';

vi.mock('../../supabase', () => {
  const rpc = vi.fn();
  return { supabase: { rpc } };
});

import { supabase } from '../../supabase';
const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

// Minimal DeliverableRow shape for each content type. approved_by is null
// so flatten* helpers don't trigger the user_profiles lookup — keeps the
// supabase mock to rpc() only.

function makeLetterRow() {
  return {
    id: 'letter-1',
    audit_id: 'audit-1',
    content: {
      recipient_name: 'Vendor Inc.',
      recipient_email: 'qa@vendor.example',
      scope_summary: 'eCOA platform validation',
      body_text: '…',
    },
    approval_status: 'DRAFT',
    approved_by: null,
    approved_at: null,
    source_risk_summary_id: 'rs-1',
    source_questionnaire_instance_id: 'qi-1',
    prefilled_at: '2026-05-15T00:00:00Z',
  };
}

function makeAgendaRow() {
  return {
    id: 'agenda-1',
    audit_id: 'audit-1',
    content: { items: [] },
    approval_status: 'DRAFT',
    approved_by: null,
    approved_at: null,
    source_risk_summary_id: 'rs-1',
    source_questionnaire_instance_id: null,
    prefilled_at: '2026-05-15T00:00:00Z',
  };
}

function makeChecklistRow() {
  return {
    id: 'checklist-1',
    audit_id: 'audit-1',
    content: { items: [] },
    approval_status: 'DRAFT',
    approved_by: null,
    approved_at: null,
    source_risk_summary_id: null,
    source_questionnaire_instance_id: 'qi-1',
    prefilled_at: '2026-05-15T00:00:00Z',
  };
}

// 23505 = Postgres unique_violation. Raised by each prefill RPC when the
// deliverable already exists; the wrapper must treat it as a no-op.
const UNIQUE_VIOLATION = { code: '23505', message: 'duplicate key value' };

// Some other server error — wrapper must log AND return null.
const PERMISSION_DENIED = { code: '42501', message: 'permission denied' };

describe.each([
  {
    name:        'prefillConfirmationLetter',
    fn:          prefillConfirmationLetter,
    rpcName:     'audit_mode_prefill_confirmation_letter',
    makeRow:     makeLetterRow,
    logPrefix:   '[preAuditApi] prefillConfirmationLetter error:',
  },
  {
    name:        'prefillAgenda',
    fn:          prefillAgenda,
    rpcName:     'audit_mode_prefill_agenda',
    makeRow:     makeAgendaRow,
    logPrefix:   '[preAuditApi] prefillAgenda error:',
  },
  {
    name:        'prefillChecklist',
    fn:          prefillChecklist,
    rpcName:     'audit_mode_prefill_checklist',
    makeRow:     makeChecklistRow,
    logPrefix:   '[preAuditApi] prefillChecklist error:',
  },
])('$name — 23505 swallow contract', ({ name: _name, fn, rpcName, makeRow, logPrefix: _logPrefix }) => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRpc.mockReset();
    // Describe-level spy is acceptable here because each test asserts the
    // call count on the spy directly — accidental suppression would surface
    // as a failing `toHaveBeenCalled` / `not.toHaveBeenCalled`.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns the flattened row on RPC success', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeRow(), error: null });

    const result = await fn('audit-1');

    expect(result).not.toBeNull();
    expect(mockRpc).toHaveBeenCalledWith(rpcName, { p_audit_id: 'audit-1' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns null on 23505 WITHOUT logging (idempotent no-op)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: UNIQUE_VIOLATION });

    const result = await fn('audit-1');

    expect(result).toBeNull();
    // The critical assertion: 23505 is silent. If we ever log this, the
    // auditor sees a scary error every time they re-open Stage 5 on an
    // audit that already has prefilled deliverables.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns null AND logs on non-23505 errors', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: PERMISSION_DENIED });

    const result = await fn('audit-1');

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    // Sanity-check the prefix so we know the RIGHT wrapper logged it
    // (not a generic catch-all somewhere else in the module).
    const [firstArg] = errorSpy.mock.calls[0];
    expect(String(firstArg)).toContain('preAuditApi');
  });
});

describe('prefillStage5Deliverables — best-effort Promise.all', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRpc.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('fires all three RPCs in parallel and returns the merged shape on full success', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: makeLetterRow(),    error: null })
      .mockResolvedValueOnce({ data: makeAgendaRow(),    error: null })
      .mockResolvedValueOnce({ data: makeChecklistRow(), error: null });

    const result = await prefillStage5Deliverables('audit-1');

    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(result.confirmation_letter).not.toBeNull();
    expect(result.agenda).not.toBeNull();
    expect(result.checklist).not.toBeNull();
  });

  it('mixed outcomes do not block each other (23505 + success + other-error)', async () => {
    // Layer-1 contract: one deliverable failing for any reason does NOT
    // prevent the other two from being prefilled. This is what makes the
    // combined wrapper "best-effort" rather than transactional.
    mockRpc
      .mockResolvedValueOnce({ data: null,              error: UNIQUE_VIOLATION  }) // letter exists
      .mockResolvedValueOnce({ data: makeAgendaRow(),   error: null              }) // agenda fresh
      .mockResolvedValueOnce({ data: null,              error: PERMISSION_DENIED }); // checklist denied

    const result = await prefillStage5Deliverables('audit-1');

    expect(result.confirmation_letter).toBeNull();
    expect(result.agenda).not.toBeNull();
    expect(result.checklist).toBeNull();

    // 23505 silent, permission_denied logged once. Net: exactly one log.
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('all-23505 (re-entry on already-prefilled audit) is fully silent', async () => {
    // The idempotency invariant in its purest form: an auditor re-opens
    // Stage 5 on an audit with all three deliverables already prefilled.
    // Wrapper fires all 3 RPCs, all return 23505, no logs, all nulls.
    mockRpc
      .mockResolvedValueOnce({ data: null, error: UNIQUE_VIOLATION })
      .mockResolvedValueOnce({ data: null, error: UNIQUE_VIOLATION })
      .mockResolvedValueOnce({ data: null, error: UNIQUE_VIOLATION });

    const result = await prefillStage5Deliverables('audit-1');

    expect(result).toEqual({
      confirmation_letter: null,
      agenda: null,
      checklist: null,
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
