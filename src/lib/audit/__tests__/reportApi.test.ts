// Unit tests for Stage 7 (Report Drafting) prefill API wrapper.
//
// Mirrors src/lib/audit/__tests__/preAuditApi.test.ts. Stage 7 has one
// prefill RPC (audit_mode_prefill_report_draft) instead of three — the
// report draft is a single 1:1 row per audit. The 23505 swallow contract
// is identical: if the row already exists, the RPC raises unique_violation
// and the wrapper must treat it as a no-op (idempotent on absence).
//
// Pattern: vi.mock('../../supabase') with inline rpc factory, mockReset
// in beforeEach, per-describe error spy (acceptable here because each
// test asserts the call count on the spy explicitly).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prefillReportDraft } from '../reportApi';

vi.mock('../../supabase', () => {
  const rpc = vi.fn();
  return { supabase: { rpc } };
});

import { supabase } from '../../supabase';
const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

function makeReportRow() {
  return {
    id: 'rd-1',
    audit_id: 'audit-1',
    executive_summary: 'Auto-drafted executive summary…',
    conclusions: '[Auditor recommendation — replace with your assessment.]',
    approval_status: 'DRAFT',
    approved_at: null,
    approved_by: null,
    final_signed_off_at: null,
    final_signed_off_by: null,
    exported_at: null,
    source_risk_summary_id: 'rs-1',
    prefilled_at: '2026-05-15T00:00:00Z',
  };
}

const UNIQUE_VIOLATION = { code: '23505', message: 'duplicate key value' };
const PERMISSION_DENIED = { code: '42501', message: 'permission denied' };

describe('prefillReportDraft — 23505 swallow contract', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRpc.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns the flattened report draft on RPC success', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeReportRow(), error: null });

    const result = await prefillReportDraft('audit-1');

    expect(result).not.toBeNull();
    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_prefill_report_draft',
      { p_audit_id: 'audit-1' },
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns null on 23505 WITHOUT logging (idempotent no-op)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: UNIQUE_VIOLATION });

    const result = await prefillReportDraft('audit-1');

    expect(result).toBeNull();
    // Same as Stage 5: silent on duplicate. The Stage 7 workspace re-fetches
    // the existing draft after this returns; we don't want a console.error
    // each time an auditor revisits Stage 7.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns null AND logs on non-23505 errors', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: PERMISSION_DENIED });

    const result = await prefillReportDraft('audit-1');

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    const [firstArg] = errorSpy.mock.calls[0];
    expect(String(firstArg)).toContain('reportApi');
  });

  it('returns null when RPC succeeds with null data (no upstream context)', async () => {
    // The RPC returns NULL (not an error) when source pre-conditions
    // aren't met — e.g. Stage 4 risk summary not yet APPROVED. Wrapper
    // must short-circuit on the null-data branch BEFORE calling flattenRow.
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await prefillReportDraft('audit-1');

    expect(result).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
