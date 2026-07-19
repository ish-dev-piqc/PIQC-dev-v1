import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IsaFindingObject } from '../../../types/audit';

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}));

import { supabase } from '../../supabase';
import {
  createIsaFinding,
  fetchIsaFindings,
  IsaFindingDraftError,
  requestIsaFindingDrafts,
  updateIsaFinding,
} from '../isaFindingsApi';

const rpcMock = vi.mocked(supabase.rpc);
const fromMock = vi.mocked(supabase.from);
const getSessionMock = vi.mocked(supabase.auth.getSession);

const NOTE_A = 'aaaaaaaa-0000-0000-0000-000000000001';

function makeFinding(overrides: Partial<IsaFindingObject> = {}): IsaFindingObject {
  return {
    id: 'finding-1',
    audit_id: 'audit-1',
    title: 'Delegation documentation incomplete',
    isa_domain: 'INVESTIGATOR_OVERSIGHT_DELEGATION',
    subcategory: null,
    severity: 'MAJOR',
    severity_rule: 'Compliance deficiency',
    observation: 'Delegation of trial-related activities was not consistently documented.',
    evidence: [{ text: 'Two staff absent from the log.', source_note_ids: [NOTE_A] }],
    reference: 'ICH E6(R3) 2.3.3',
    response_owner: 'SITE',
    origin: 'PIQC_DRAFTED',
    created_by: 'user-1',
    created_at: '2026-07-19T18:00:00Z',
    updated_at: '2026-07-19T18:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchIsaFindings', () => {
  it('returns findings oldest-first', async () => {
    const finding = makeFinding();
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.order.mockResolvedValue({ data: [finding], error: null });
    fromMock.mockReturnValue(chain as never);

    const res = await fetchIsaFindings('audit-1');

    expect(fromMock).toHaveBeenCalledWith('isa_finding_objects');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(res).toEqual({ ok: true, data: [finding] });
  });
});

describe('createIsaFinding', () => {
  it('maps input to RPC params with defaults', async () => {
    const finding = makeFinding();
    rpcMock.mockResolvedValue({ data: finding, error: null } as never);

    const res = await createIsaFinding('audit-1', {
      title: finding.title,
      isaDomain: finding.isa_domain,
      severity: finding.severity,
      observation: finding.observation,
      evidence: finding.evidence,
      origin: 'PIQC_DRAFTED',
      severityRule: finding.severity_rule,
      reference: finding.reference,
    });

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_create_isa_finding', {
      p_audit_id: 'audit-1',
      p_title: finding.title,
      p_isa_domain: finding.isa_domain,
      p_severity: finding.severity,
      p_observation: finding.observation,
      p_evidence: finding.evidence,
      p_origin: 'PIQC_DRAFTED',
      p_subcategory: null,
      p_severity_rule: finding.severity_rule,
      p_reference: finding.reference,
      p_response_owner: 'SITE',
    });
    expect(res).toEqual({ ok: true, data: finding });
  });

  it('maps the evidence-gate rejection to ok:false', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'evidence cites a note that is missing, deleted, or already promoted' },
    } as never);

    const res = await createIsaFinding('audit-1', {
      title: 't',
      isaDomain: 'OTHER',
      severity: 'MINOR',
      observation: 'o',
      evidence: [{ text: 'x', source_note_ids: ['gone'] }],
      origin: 'PIQC_DRAFTED',
    });

    expect(res.ok).toBe(false);
  });
});

describe('updateIsaFinding', () => {
  it('passes clear flags and leave-alone nulls', async () => {
    const finding = makeFinding({ reference: null, origin: 'PIQC_EDITED' });
    rpcMock.mockResolvedValue({ data: finding, error: null } as never);

    await updateIsaFinding('finding-1', { clearReference: true, severity: 'MINOR' });

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_update_isa_finding', {
      p_id: 'finding-1',
      p_title: null,
      p_isa_domain: null,
      p_subcategory: null,
      p_clear_subcategory: false,
      p_severity: 'MINOR',
      p_severity_rule: null,
      p_clear_severity_rule: false,
      p_observation: null,
      p_evidence: null,
      p_reference: null,
      p_clear_reference: true,
      p_response_owner: null,
    });
  });
});

describe('requestIsaFindingDrafts', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('POSTs the audit id under the session JWT and returns the parsed payload', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'jwt-token' } },
    } as never);
    const payload = {
      drafts: [],
      withheld_count: 1,
      stripped_reference_count: 0,
      note_count: 4,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    globalThis.fetch = fetchMock as never;

    const res = await requestIsaFindingDrafts('audit-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/isa-finding-draft');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');
    expect(JSON.parse(init.body as string)).toEqual({ audit_id: 'audit-1' });
    expect(res).toEqual(payload);
  });

  it('includes note_ids only when a non-empty selection is passed', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'jwt-token' } },
    } as never);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ drafts: [], withheld_count: 0, stripped_reference_count: 0, note_count: 1 }),
    });
    globalThis.fetch = fetchMock as never;

    await requestIsaFindingDrafts('audit-1', [NOTE_A]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ audit_id: 'audit-1', note_ids: [NOTE_A] });
  });

  it('throws a typed error carrying the server message and status', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'jwt-token' } },
    } as never);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'No draftable notes' }),
    }) as never;

    await expect(requestIsaFindingDrafts('audit-1')).rejects.toThrowError(IsaFindingDraftError);
    await expect(requestIsaFindingDrafts('audit-1')).rejects.toMatchObject({
      status: 409,
      message: 'No draftable notes',
    });
  });
});
