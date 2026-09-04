// Unit tests for protocolReadinessApi — the Stage-1 "is the protocol parsed?"
// read model.
//
//   1. deriveProtocolReadiness is the whole state machine; every precedence
//      row is locked here so the card can stay dumb.
//   2. fetchProtocolDocumentStatus: PGRST202 (RPC not applied on this project)
//      is { ok: true, data: { available: false } } — the one error code that is
//      NOT an error, and never "no protocol". Every other error is ok:false.
//   3. checkIngestStatus: never polls on the anon key; non-2xx and malformed
//      bodies are ok:false with the server's reason; fetch throwing is ok:false.
//
// Mock idiom: isaFindingsApi.test.ts (inline supabase mock with rpc + auth),
// fetch stubbed per test via vi.stubGlobal.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProtocolDocumentStatus } from '../../../types/audit';

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}));

import { supabase } from '../../supabase';
import {
  checkIngestStatus,
  deriveProtocolReadiness,
  fetchProtocolDocumentStatus,
} from '../protocolReadinessApi';

const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;

const BASE: ProtocolDocumentStatus = {
  protocol_id: 'protocol-1',
  any_ready: 0,
  own_ready: 0,
  any_pending: 0,
  own_pending_document_id: null,
  own_failed_error: null,
  visible_item_count: 0,
};

describe('deriveProtocolReadiness — precedence table', () => {
  it.each<[string, Partial<ProtocolDocumentStatus>, ReturnType<typeof deriveProtocolReadiness>]>([
    ['nothing at all', {}, { kind: 'none' }],
    [
      'own pending upload wins over everything',
      { own_pending_document_id: 'doc-9', any_ready: 1, visible_item_count: 12, own_failed_error: 'old' },
      { kind: 'parsing', documentId: 'doc-9' },
    ],
    [
      'ready with visible items',
      { any_ready: 1, visible_item_count: 12 },
      { kind: 'ready', itemCount: 12 },
    ],
    [
      'ready is never masked by a stale failed row',
      { any_ready: 1, visible_item_count: 12, own_failed_error: 'Reducto job ended with status: failed' },
      { kind: 'ready', itemCount: 12 },
    ],
    [
      "ready is never masked by someone else's pending copy",
      { any_ready: 1, visible_item_count: 3, any_pending: 1 },
      { kind: 'ready', itemCount: 3 },
    ],
    ['ready without items', { any_ready: 1, visible_item_count: 0 }, { kind: 'ready_no_items' }],
    [
      'ready without items outranks a failed row (its own remedy applies)',
      { any_ready: 1, own_failed_error: 'x' },
      { kind: 'ready_no_items' },
    ],
    ['another account is parsing', { any_pending: 2 }, { kind: 'parsing_elsewhere' }],
    [
      'own failure with nothing ready',
      { own_failed_error: 'Reducto job ended with status: failed' },
      { kind: 'failed', error: 'Reducto job ended with status: failed' },
    ],
    [
      'own failure while another account is parsing → parsing elsewhere first',
      { own_failed_error: 'x', any_pending: 1 },
      { kind: 'parsing_elsewhere' },
    ],
  ])('%s', (_label, patch, expected) => {
    expect(deriveProtocolReadiness({ ...BASE, ...patch })).toEqual(expected);
  });
});

describe('fetchProtocolDocumentStatus', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('maps PGRST202 (RPC not applied yet) to available:false, not to an error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });
    const res = await fetchProtocolDocumentStatus('audit-1');
    expect(res).toEqual({ ok: true, data: { available: false } });
    expect(mockRpc).toHaveBeenCalledWith('audit_mode_protocol_document_status', {
      p_audit_id: 'audit-1',
    });
  });

  it('surfaces every other RPC error as ok:false with its message', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'Audit audit-1 not found' },
    });
    const res = await fetchProtocolDocumentStatus('audit-1');
    expect(res).toEqual({ ok: false, error: 'Audit audit-1 not found' });
  });

  it('returns the payload as available:true', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ...BASE, any_ready: 1, visible_item_count: 4 }, error: null });
    const res = await fetchProtocolDocumentStatus('audit-1');
    expect(res).toEqual({
      ok: true,
      data: { available: true, ...BASE, any_ready: 1, visible_item_count: 4 },
    });
  });
});

describe('checkIngestStatus', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mockGetSession.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses to poll without a session and never calls fetch', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    const res = await checkIngestStatus('doc-1');
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the status with the session token on 200', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'jwt-1' } } });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'pending', document_id: 'doc-1', protocol_id: null }),
    });
    const res = await checkIngestStatus('doc-1');
    expect(res).toEqual({ ok: true, data: { status: 'pending', error_message: null } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/functions\/v1\/ingest-status$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1');
    expect(JSON.parse(init.body as string)).toEqual({ document_id: 'doc-1' });
  });

  it('carries the failure reason on a failed parse', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'jwt-1' } } });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'failed', document_id: 'doc-1', error_message: 'Reducto job ended with status: failed' }),
    });
    const res = await checkIngestStatus('doc-1');
    expect(res).toEqual({
      ok: true,
      data: { status: 'failed', error_message: 'Reducto job ended with status: failed' },
    });
  });

  it("is ok:false with the server's reason on a non-2xx", async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'jwt-1' } } });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Document not found' }),
    });
    const res = await checkIngestStatus('doc-1');
    expect(res).toEqual({ ok: false, error: 'Document not found' });
  });

  it('is ok:false when fetch itself throws', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'jwt-1' } } });
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const res = await checkIngestStatus('doc-1');
    expect(res).toEqual({ ok: false, error: 'network down' });
  });
});
