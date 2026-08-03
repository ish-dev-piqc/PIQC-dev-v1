import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabase client (rpc + storage.from().createSignedUrl())
vi.mock('../../supabase', () => {
  const createSignedUrl = vi.fn();
  const from = vi.fn(() => ({ createSignedUrl }));
  const rpc = vi.fn();
  return {
    supabase: {
      rpc,
      storage: { from },
    },
    __mocks: { rpc, from, createSignedUrl },
  };
});

import { fetchProtocolPdfUrl } from '../protocolPdfApi';
import { supabase } from '../../supabase';

const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFrom = (supabase.storage as any).from as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateSignedUrl = (mockFrom as any)().createSignedUrl as ReturnType<typeof vi.fn>;

// =============================================================================
// protocolPdfApi — Site Mode's own signed-URL helper for the Protocol tab's
// "View PDF" button. Mirrors src/lib/sotr/protocolPdfApi.ts (same RPC + same
// storage bucket) but implemented locally to avoid a cross-mode import that
// isn't on the piqc-discipline ALLOWED_CROSS_MODE allowlist. Returns
// Result<T> (never throws) per the site lib's Api convention.
// =============================================================================

describe('fetchProtocolPdfUrl — happy path', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockCreateSignedUrl.mockReset();
  });

  it('returns ok:true with the signed URL', async () => {
    const SECRET_URL = 'https://x.supabase.co/storage/v1/sign/protocol-pdfs/SECRET-PATH?token=ABC';
    mockRpc.mockResolvedValueOnce({ data: 'protocol-1/doc-1.pdf', error: null });
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: SECRET_URL },
      error: null,
    });

    const result = await fetchProtocolPdfUrl('protocol-1', 'doc-1');

    expect(result).toEqual({ ok: true, data: SECRET_URL });
    expect(mockRpc).toHaveBeenCalledWith('sotr_get_protocol_pdf_storage_path', {
      p_study_id: 'protocol-1',
      p_document_id: 'doc-1',
    });
    expect(mockFrom).toHaveBeenCalledWith('protocol-pdfs');
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('protocol-1/doc-1.pdf', 60);
  });
});

describe('fetchProtocolPdfUrl — error mapping', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockCreateSignedUrl.mockReset();
  });

  it('maps RPC code 02000 to a "no PDF retained" message', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '02000', message: 'No PDF retained' },
    });

    const result = await fetchProtocolPdfUrl('protocol-1', 'doc-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no pdf retained/i);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it('maps RPC code 42501 to an access-denied message', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'access denied' },
    });

    const result = await fetchProtocolPdfUrl('protocol-1', 'doc-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/access denied/i);
  });

  it('maps an unknown RPC error code to its message', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XXXXX', message: 'something else' },
    });

    const result = await fetchProtocolPdfUrl('protocol-1', 'doc-1');

    expect(result).toEqual({ ok: false, error: 'something else' });
  });

  it('returns "no PDF retained" when the RPC path is null/missing', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await fetchProtocolPdfUrl('protocol-1', 'doc-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no pdf retained/i);
  });

  it('returns a signing-failure message when storage signing fails', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'protocol-1/doc-1.pdf', error: null });
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'storage failure' },
    });

    const result = await fetchProtocolPdfUrl('protocol-1', 'doc-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/could not sign/i);
  });

  it('returns a signing-failure message when signedUrl is missing from the response', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'protocol-1/doc-1.pdf', error: null });
    mockCreateSignedUrl.mockResolvedValueOnce({ data: {}, error: null });

    const result = await fetchProtocolPdfUrl('protocol-1', 'doc-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/could not sign/i);
  });
});
