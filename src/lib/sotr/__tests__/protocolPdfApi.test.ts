import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    // Surfaced for tests:
    __mocks: { rpc, from, createSignedUrl },
  };
});

import {
  fetchProtocolPdfUrl,
  ProtocolPdfNotRetainedError,
  ProtocolPdfAccessDeniedError,
  ProtocolPdfSigningError,
  PROTOCOL_PDF_SIGNED_URL_TTL_SECONDS,
} from '../protocolPdfApi';
import { supabase } from '../../supabase';

const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFrom = (supabase.storage as any).from as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateSignedUrl = (mockFrom as any)().createSignedUrl as ReturnType<typeof vi.fn>;

describe('fetchProtocolPdfUrl — happy path', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRpc.mockReset();
    mockCreateSignedUrl.mockReset();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => infoSpy.mockRestore());

  it('returns a signed URL with the configured TTL and never logs the URL', async () => {
    const SECRET_URL = 'https://x.supabase.co/storage/v1/sign/protocol-pdfs/SECRET-PATH?token=ABC';
    mockRpc.mockResolvedValueOnce({ data: 'user-1/doc-1.pdf', error: null });
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: SECRET_URL },
      error: null,
    });

    const before = Date.now();
    const result = await fetchProtocolPdfUrl('study-1', 'doc-1');
    const after = Date.now();

    expect(result.url).toBe(SECRET_URL);
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + PROTOCOL_PDF_SIGNED_URL_TTL_SECONDS * 1000);
    expect(result.expiresAt).toBeLessThanOrEqual(after + PROTOCOL_PDF_SIGNED_URL_TTL_SECONDS * 1000 + 50);

    expect(mockRpc).toHaveBeenCalledWith('sotr_get_protocol_pdf_storage_path', {
      p_study_id: 'study-1',
      p_document_id: 'doc-1',
    });
    expect(mockFrom).toHaveBeenCalledWith('protocol-pdfs');
    expect(mockCreateSignedUrl).toHaveBeenCalledWith(
      'user-1/doc-1.pdf',
      PROTOCOL_PDF_SIGNED_URL_TTL_SECONDS,
    );

    // Safe-log invariant: no URL, no path in any console call.
    const logged = infoSpy.mock.calls
      .map((args) => args.map((a) => JSON.stringify(a)).join(' '))
      .join(' ');
    expect(logged).not.toContain(SECRET_URL);
    expect(logged).not.toContain('user-1/doc-1.pdf');
    expect(logged).not.toContain('SECRET-PATH');
    expect(logged).toContain('expiresInSeconds');
  });
});

describe('fetchProtocolPdfUrl — error mapping', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockCreateSignedUrl.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws ProtocolPdfNotRetainedError when RPC returns 02000', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '02000', message: 'No PDF retained' },
    });

    await expect(fetchProtocolPdfUrl('study-1', 'doc-1'))
      .rejects.toBeInstanceOf(ProtocolPdfNotRetainedError);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it('throws ProtocolPdfAccessDeniedError when RPC returns 42501', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'access denied' },
    });

    await expect(fetchProtocolPdfUrl('study-1', 'doc-1'))
      .rejects.toBeInstanceOf(ProtocolPdfAccessDeniedError);
  });

  it('throws ProtocolPdfNotRetainedError when path is null/missing', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchProtocolPdfUrl('study-1', 'doc-1'))
      .rejects.toBeInstanceOf(ProtocolPdfNotRetainedError);
  });

  it('throws ProtocolPdfSigningError when storage signing fails', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'user-1/doc-1.pdf', error: null });
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'storage failure' },
    });

    await expect(fetchProtocolPdfUrl('study-1', 'doc-1'))
      .rejects.toBeInstanceOf(ProtocolPdfSigningError);
  });

  it('throws ProtocolPdfSigningError on unknown RPC error code', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XXXXX', message: 'something else' },
    });

    await expect(fetchProtocolPdfUrl('study-1', 'doc-1'))
      .rejects.toBeInstanceOf(ProtocolPdfSigningError);
  });
});
