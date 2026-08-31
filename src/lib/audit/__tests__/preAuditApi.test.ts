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
  upsertInternalNotification,
  approveInternalNotification,
  upsertEvidenceGapSummary,
  approveEvidenceGapSummary,
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
    name:    'prefillConfirmationLetter',
    fn:      prefillConfirmationLetter,
    rpcName: 'audit_mode_prefill_confirmation_letter',
    makeRow: makeLetterRow,
    // Used in the non-23505 test to verify the RIGHT wrapper logged, not a
    // generic catch-all somewhere else in the module.
    logTag:  'prefillConfirmationLetter',
  },
  {
    name:    'prefillAgenda',
    fn:      prefillAgenda,
    rpcName: 'audit_mode_prefill_agenda',
    makeRow: makeAgendaRow,
    logTag:  'prefillAgenda',
  },
  {
    name:    'prefillChecklist',
    fn:      prefillChecklist,
    rpcName: 'audit_mode_prefill_checklist',
    makeRow: makeChecklistRow,
    logTag:  'prefillChecklist',
  },
])('$name — 23505 swallow contract', ({ fn, rpcName, makeRow, logTag }) => {
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
    // Asserts both modules ("preAuditApi") and the specific wrapper
    // (logTag) — locks down that the RIGHT wrapper logged, not a
    // generic catch-all somewhere else in the file.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[preAuditApi] ${logTag}`),
      expect.anything(),
    );
  });
});

describe('prefillStage5Deliverables — best-effort Promise.all', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  // Route each call by RPC name rather than by call order. The wrapper
  // uses Promise.all over [letter, agenda, checklist], which means the
  // mock queue happens to match by index today — but if anyone ever
  // reorders that array, the order-based mock would silently route the
  // wrong rows to the wrong wrappers. Routing by RPC name removes that
  // coupling: the test passes only if each wrapper actually fired its
  // own RPC, regardless of which order they ran in.
  function mockRpcByName(
    routes: Record<string, { data: unknown; error: unknown }>,
  ) {
    mockRpc.mockImplementation((rpcName: string) => {
      const route = routes[rpcName];
      if (!route) {
        return Promise.reject(new Error(`Unexpected RPC: ${rpcName}`));
      }
      return Promise.resolve(route);
    });
  }

  beforeEach(() => {
    mockRpc.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('fires all three RPCs and returns the merged shape on full success', async () => {
    mockRpcByName({
      audit_mode_prefill_confirmation_letter: { data: makeLetterRow(),    error: null },
      audit_mode_prefill_agenda:              { data: makeAgendaRow(),    error: null },
      audit_mode_prefill_checklist:           { data: makeChecklistRow(), error: null },
    });

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
    mockRpcByName({
      audit_mode_prefill_confirmation_letter: { data: null,            error: UNIQUE_VIOLATION  }, // letter exists
      audit_mode_prefill_agenda:              { data: makeAgendaRow(), error: null              }, // agenda fresh
      audit_mode_prefill_checklist:           { data: null,            error: PERMISSION_DENIED }, // checklist denied
    });

    const result = await prefillStage5Deliverables('audit-1');

    expect(result.confirmation_letter).toBeNull();
    expect(result.agenda).not.toBeNull();
    expect(result.checklist).toBeNull();

    // 23505 silent, permission_denied logged once — and we lock down
    // that the SPECIFIC wrapper (checklist) is the one that logged.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[preAuditApi] prefillChecklist'),
      expect.anything(),
    );
  });

  it('all-23505 (re-entry on already-prefilled audit) is fully silent', async () => {
    // The idempotency invariant in its purest form: an auditor re-opens
    // Stage 5 on an audit with all three deliverables already prefilled.
    // Wrapper fires all 3 RPCs, all return 23505, no logs, all nulls.
    mockRpcByName({
      audit_mode_prefill_confirmation_letter: { data: null, error: UNIQUE_VIOLATION },
      audit_mode_prefill_agenda:              { data: null, error: UNIQUE_VIOLATION },
      audit_mode_prefill_checklist:           { data: null, error: UNIQUE_VIOLATION },
    });

    const result = await prefillStage5Deliverables('audit-1');

    expect(result).toEqual({
      confirmation_letter: null,
      agenda: null,
      checklist: null,
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Internal notification (PR-D1) — the 4th deliverable has NO prefill by
// design; its wrappers are the plain upsert + CAS-approve pair.
// ---------------------------------------------------------------------------

function makeNotificationRow() {
  return {
    id: 'notification-1',
    audit_id: 'audit-1',
    content: { body_text: 'Internal heads-up …', scope: ['eCOA validation'] },
    approval_status: 'DRAFT',
    approved_by: null,
    approved_at: null,
    updated_at: '2026-09-04T00:00:00Z',
  };
}

describe('upsertInternalNotification', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRpc.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('calls the RPC with audit id + content and returns the flattened row', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeNotificationRow(), error: null });

    const content = { body_text: 'Internal heads-up …', scope: ['eCOA validation'] };
    const result = await upsertInternalNotification('audit-1', content);

    expect(mockRpc).toHaveBeenCalledWith('audit_mode_upsert_internal_notification', {
      p_audit_id: 'audit-1',
      p_content: content,
      p_reason: null,
    });
    expect(result?.id).toBe('notification-1');
    expect(result?.content.body_text).toBe('Internal heads-up …');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns null and logs on RPC error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: PERMISSION_DENIED });

    const result = await upsertInternalNotification('audit-1', { body_text: 'x', scope: [] });

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[preAuditApi] upsertInternalNotification'),
      expect.anything(),
    );
  });
});

describe('approveInternalNotification', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('passes the CAS version (p_expected_updated_at) and returns ok on success', async () => {
    const approved = { ...makeNotificationRow(), approval_status: 'APPROVED' };
    mockRpc.mockResolvedValueOnce({ data: approved, error: null });

    const result = await approveInternalNotification('notification-1', '2026-09-04T00:00:00Z');

    expect(mockRpc).toHaveBeenCalledWith('audit_mode_approve_internal_notification', {
      p_id: 'notification-1',
      p_reason: null,
      p_expected_updated_at: '2026-09-04T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.approval_status).toBe('APPROVED');
  });

  it('surfaces the server hint on CAS rejection (STALE_CONTENT)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '40001', message: 'changed since reviewed', hint: 'STALE_CONTENT' },
    });

    const result = await approveInternalNotification('notification-1', '2026-09-04T00:00:00Z');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorHint).toBe('STALE_CONTENT');
  });
});

// ---------------------------------------------------------------------------
// Evidence gap summary (PR-D3) — the 5th deliverable clones the notification's
// no-prefill lifecycle: plain upsert + CAS-approve pair against its own RPCs.
// ---------------------------------------------------------------------------

function makeGapSummaryRow() {
  return {
    id: 'gap-1',
    audit_id: 'audit-1',
    content: {
      body_text: 'Data management: SOP index on file; audit trail export outstanding.',
      scope: ['data_management'],
    },
    approval_status: 'DRAFT',
    approved_by: null,
    approved_at: null,
    updated_at: '2026-09-05T00:00:00Z',
  };
}

describe('upsertEvidenceGapSummary', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRpc.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('calls the RPC with audit id + content and returns the flattened row', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeGapSummaryRow(), error: null });

    const content = {
      body_text: 'Data management: SOP index on file; audit trail export outstanding.',
      scope: ['data_management'],
    };
    const result = await upsertEvidenceGapSummary('audit-1', content);

    expect(mockRpc).toHaveBeenCalledWith('audit_mode_upsert_evidence_gap_summary', {
      p_audit_id: 'audit-1',
      p_content: content,
      p_reason: null,
    });
    expect(result?.id).toBe('gap-1');
    expect(result?.content.scope).toEqual(['data_management']);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns null and logs on RPC error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: PERMISSION_DENIED });

    const result = await upsertEvidenceGapSummary('audit-1', { body_text: 'x', scope: [] });

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[preAuditApi] upsertEvidenceGapSummary'),
      expect.anything(),
    );
  });
});

describe('approveEvidenceGapSummary', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('passes the CAS version (p_expected_updated_at) and returns ok on success', async () => {
    const approved = { ...makeGapSummaryRow(), approval_status: 'APPROVED' };
    mockRpc.mockResolvedValueOnce({ data: approved, error: null });

    const result = await approveEvidenceGapSummary('gap-1', '2026-09-05T00:00:00Z');

    expect(mockRpc).toHaveBeenCalledWith('audit_mode_approve_evidence_gap_summary', {
      p_id: 'gap-1',
      p_reason: null,
      p_expected_updated_at: '2026-09-05T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.approval_status).toBe('APPROVED');
  });

  it('surfaces the server hint on CAS rejection (STALE_CONTENT)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '40001', message: 'changed since reviewed', hint: 'STALE_CONTENT' },
    });

    const result = await approveEvidenceGapSummary('gap-1', '2026-09-05T00:00:00Z');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorHint).toBe('STALE_CONTENT');
  });
});
