// Unit tests for the auditCreationApi Result<T> contract.
//
// The point of the refactor: a DB error must be distinguishable from a
// legitimately empty list, and createAudit must surface the RPC's specific
// message instead of collapsing every failure to null. These tests lock that
// contract at the API boundary.
//
// Mock surface mirrors intakeApi.test.ts (inline supabase mock), extended with
// a chainable from().select().order() terminal for the table-read paths. The
// shared mock fns are declared via vi.hoisted so the tests can drive them
// without reaching through the chain.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockOrder, mockRpc, mockGetSession } = vi.hoisted(() => ({
  mockOrder: vi.fn(),
  mockRpc: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('../../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ order: mockOrder })),
    })),
    rpc: mockRpc,
    auth: { getSession: mockGetSession },
  },
}));

import { listVendors, createAudit, uploadProtocolPdf } from '../auditCreationApi';

const VENDORS = [
  { id: 'v1', name: 'Acme CRO', legal_name: null, country: 'USA', website: null },
];

describe('auditCreationApi — Result contract', () => {
  beforeEach(() => {
    mockOrder.mockReset();
    mockRpc.mockReset();
  });

  it('listVendors returns { ok: true, data } on success', async () => {
    mockOrder.mockResolvedValueOnce({ data: VENDORS, error: null });
    const res = await listVendors();
    expect(res).toEqual({ ok: true, data: VENDORS });
  });

  it('listVendors returns { ok: false, error } on a query error (never a silent empty list)', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    const res = await listVendors();
    expect(res).toEqual({ ok: false, error: 'permission denied' });
  });

  it('createAudit surfaces the RPC error.message on failure', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Protocol version pv-9 not found' },
    });
    const res = await createAudit({
      auditName: 'Q2 audit',
      workflowType: 'VENDOR_AUDIT',
      vendorId: 'v1',
      protocolVersionId: 'pv-9',
      auditType: 'REMOTE',
    });
    expect(res).toEqual({ ok: false, error: 'Protocol version pv-9 not found' });
  });

  it('createAudit returns { ok: true, data } on success', async () => {
    const row = { id: 'audit-1' };
    mockRpc.mockResolvedValueOnce({ data: row, error: null });
    const res = await createAudit({
      auditName: 'Q2 audit',
      workflowType: 'VENDOR_AUDIT',
      vendorId: 'v1',
      protocolVersionId: 'pv-1',
      auditType: 'REMOTE',
    });
    expect(res).toEqual({ ok: true, data: row });
  });
});

// -----------------------------------------------------------------------------
// uploadProtocolPdf — the Stage-1 re-upload pins the document to the audit's
// protocol (protocol_id in the /ingest body); the new-audit drawer must keep
// sending no pin. The result passes /ingest's status + deduped through.
//
// FileReader is stubbed: the base64 step is happy-dom-independent this way and
// the body assertion stays about the pin, not the encoding.
// -----------------------------------------------------------------------------
describe('uploadProtocolPdf — protocol pin', () => {
  const fetchMock = vi.fn();

  class FileReaderStub {
    result: string | null = null;
    onload: null | (() => void) = null;
    onerror: null | ((e: unknown) => void) = null;
    readAsDataURL() {
      this.result = 'data:application/pdf;base64,QUJD';
      queueMicrotask(() => this.onload?.());
    }
  }

  beforeEach(() => {
    fetchMock.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt-1' } } });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('FileReader', FileReaderStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function ingestResponse(payload: Record<string, unknown>, status = 202) {
    return { ok: true, status, json: async () => payload };
  }

  it('sends protocol_id when a pin is given and passes status/deduped through', async () => {
    fetchMock.mockResolvedValueOnce(
      ingestResponse({ success: true, document_id: 'doc-1', status: 'pending' }),
    );
    const file = new File(['%PDF'], 'protocol.pdf', { type: 'application/pdf' });

    const res = await uploadProtocolPdf(file, undefined, 'protocol-1');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.protocol_id).toBe('protocol-1');
    expect(body.pdf_base64).toBe('QUJD');
    expect(body.title).toBe('protocol');
    expect(res).toEqual({ success: true, document_id: 'doc-1', status: 'pending' });
  });

  it('sends no protocol_id without a pin (new-audit drawer path)', async () => {
    fetchMock.mockResolvedValueOnce(
      ingestResponse({ success: true, document_id: 'doc-2', status: 'ready', deduped: true }, 200),
    );
    const file = new File(['%PDF'], 'protocol.pdf', { type: 'application/pdf' });

    const res = await uploadProtocolPdf(file, 'My title');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect('protocol_id' in body).toBe(false);
    expect(body.title).toBe('My title');
    expect(res.deduped).toBe(true);
    expect(res.status).toBe('ready');
  });
});
