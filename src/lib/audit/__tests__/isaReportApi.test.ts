import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IsaReportDraftObject } from '../../../types/audit';

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

import { supabase } from '../../supabase';
import { fetchIsaReportDraft, upsertIsaReportDraft } from '../isaReportApi';

const rpcMock = vi.mocked(supabase.rpc);
const fromMock = vi.mocked(supabase.from);

function makeDraft(overrides: Partial<IsaReportDraftObject> = {}): IsaReportDraftObject {
  return {
    id: 'draft-1',
    audit_id: 'audit-1',
    exec_summary: null,
    auditee_background: null,
    opening_meeting: null,
    closing_meeting: null,
    site_verdict: null,
    site_verdict_text: null,
    response_due_days: 30,
    response_due_basis: 'CALENDAR',
    created_by: 'user-1',
    created_at: '2026-07-19T10:00:00Z',
    updated_at: '2026-07-19T10:00:00Z',
    ...overrides,
  };
}

function mockSelectChain(result: { data: unknown; error: { message: string } | null }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);
  fromMock.mockReturnValue(chain as never);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchIsaReportDraft', () => {
  it('returns the row when one exists', async () => {
    const draft = makeDraft();
    const chain = mockSelectChain({ data: draft, error: null });

    const res = await fetchIsaReportDraft('audit-1');

    expect(fromMock).toHaveBeenCalledWith('isa_report_draft_objects');
    expect(chain.eq).toHaveBeenCalledWith('audit_id', 'audit-1');
    expect(res).toEqual({ ok: true, data: draft });
  });

  it('returns ok with null when no draft row exists yet (lazy creation)', async () => {
    mockSelectChain({ data: null, error: null });

    const res = await fetchIsaReportDraft('audit-1');

    expect(res).toEqual({ ok: true, data: null });
  });

  it('maps a select error to ok:false', async () => {
    mockSelectChain({ data: null, error: { message: 'permission denied' } });

    const res = await fetchIsaReportDraft('audit-1');

    expect(res).toEqual({ ok: false, error: 'permission denied' });
  });
});

describe('upsertIsaReportDraft', () => {
  it('maps the verdict save with nuance text and leave-alone nulls elsewhere', async () => {
    const draft = makeDraft({ site_verdict: 'CONTINUE', site_verdict_text: 'Nuance.' });
    rpcMock.mockResolvedValue({ data: draft, error: null } as never);

    const res = await upsertIsaReportDraft('audit-1', {
      siteVerdict: 'CONTINUE',
      siteVerdictText: 'Nuance.',
    });

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_upsert_isa_report_draft', {
      p_audit_id: 'audit-1',
      p_exec_summary: null,
      p_clear_exec_summary: false,
      p_auditee_background: null,
      p_clear_auditee_background: false,
      p_opening_meeting: null,
      p_clear_opening_meeting: false,
      p_closing_meeting: null,
      p_clear_closing_meeting: false,
      p_site_verdict: 'CONTINUE',
      p_clear_site_verdict: false,
      p_site_verdict_text: 'Nuance.',
      p_clear_site_verdict_text: false,
      p_response_due_days: null,
      p_response_due_basis: null,
      p_reason: null,
    });
    expect(res).toEqual({ ok: true, data: draft });
  });

  it('passes clear flags to return a section to templated', async () => {
    const draft = makeDraft();
    rpcMock.mockResolvedValue({ data: draft, error: null } as never);

    await upsertIsaReportDraft('audit-1', { clearExecSummary: true });

    expect(rpcMock).toHaveBeenCalledWith(
      'audit_mode_upsert_isa_report_draft',
      expect.objectContaining({ p_clear_exec_summary: true, p_exec_summary: null }),
    );
  });

  it('maps the vendor-workflow rejection to ok:false', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'ISA report drafts are only available on investigator site audits' },
    } as never);

    const res = await upsertIsaReportDraft('audit-1', { openingMeeting: 'x' });

    expect(res.ok).toBe(false);
  });
});
