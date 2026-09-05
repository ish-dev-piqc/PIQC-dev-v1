// auditApi.advanceAuditStage — the one wrapper AuditContext calls for both
// pipelines. Since isa-stage-advance it picks the RPC by the target stage's
// pipeline: vendor stages → audit_mode_advance_audit_stage, ISA_* stages →
// audit_mode_advance_isa_stage. The two pipelines share no stage value, so
// the choice is deterministic; a mismatched pair fails closed on the server
// (STAGE_NOT_IN_ADVANCEMENT_MAP / WORKFLOW_NOT_ISA), which is the error
// shape pinned last. Mock idiom: intakeApi.test.ts (vi.mock('../../supabase')
// with an inline rpc factory).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { advanceAuditStage } from '../auditApi';
import { stagesForWorkflow } from '../workflowStages';

vi.mock('../../supabase', () => {
  const rpc = vi.fn();
  return { supabase: { rpc } };
});

import { supabase } from '../../supabase';
const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe('advanceAuditStage — RPC routing by pipeline', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    // The error branch logs; keep the run quiet and assert on the result.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('vendor stage → audit_mode_advance_audit_stage, reason defaults to null', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { id: 'audit-1', current_stage: 'VENDOR_ENRICHMENT' },
      error: null,
    });

    const result = await advanceAuditStage('audit-1', 'VENDOR_ENRICHMENT');

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('audit_mode_advance_audit_stage', {
      p_audit_id: 'audit-1',
      p_to_stage: 'VENDOR_ENRICHMENT',
      p_reason: null,
    });
    expect(result).toEqual({ ok: true, currentStage: 'VENDOR_ENRICHMENT' });
  });

  it('ISA stage → audit_mode_advance_isa_stage, reason forwarded', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { id: 'audit-isa-1', current_stage: 'ISA_RISK_ASSESSMENT' },
      error: null,
    });

    const result = await advanceAuditStage('audit-isa-1', 'ISA_RISK_ASSESSMENT', 'Site confirmed');

    expect(mockRpc).toHaveBeenCalledWith('audit_mode_advance_isa_stage', {
      p_audit_id: 'audit-isa-1',
      p_to_stage: 'ISA_RISK_ASSESSMENT',
      p_reason: 'Site confirmed',
    });
    expect(result).toEqual({ ok: true, currentStage: 'ISA_RISK_ASSESSMENT' });
  });

  it('every stage of each pipeline routes to that pipeline’s RPC', async () => {
    for (const stage of stagesForWorkflow('INVESTIGATOR_SITE_AUDIT')) {
      mockRpc.mockResolvedValueOnce({ data: { id: 'a', current_stage: stage }, error: null });
      await advanceAuditStage('a', stage);
      expect(mockRpc).toHaveBeenLastCalledWith(
        'audit_mode_advance_isa_stage',
        expect.objectContaining({ p_to_stage: stage }),
      );
    }
    for (const stage of stagesForWorkflow('VENDOR_AUDIT')) {
      mockRpc.mockResolvedValueOnce({ data: { id: 'a', current_stage: stage }, error: null });
      await advanceAuditStage('a', stage);
      expect(mockRpc).toHaveBeenLastCalledWith(
        'audit_mode_advance_audit_stage',
        expect.objectContaining({ p_to_stage: stage }),
      );
    }
  });

  it('server rejection → ok false with the message and the hint the card renders', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Audit audit-1 is not an investigator site audit',
        hint: 'WORKFLOW_NOT_ISA',
      },
    });

    const result = await advanceAuditStage('audit-1', 'ISA_RISK_ASSESSMENT');

    expect(result).toEqual({
      ok: false,
      errorMessage: 'Audit audit-1 is not an investigator site audit',
      errorHint: 'WORKFLOW_NOT_ISA',
    });
  });

  it('function not yet applied (PGRST202, before db push) is a plain failure, never ok', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.audit_mode_advance_isa_stage(p_audit_id, p_reason, p_to_stage) in the schema cache',
      },
    });

    const result = await advanceAuditStage('audit-isa-1', 'ISA_RISK_ASSESSMENT');

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/audit_mode_advance_isa_stage/);
    expect(result.errorHint).toBeUndefined();
    expect(result.currentStage).toBeUndefined();
  });
});
