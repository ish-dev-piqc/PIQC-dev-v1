import { describe, expect, it, vi, beforeEach } from 'vitest';

// =============================================================================
// contactApi smoke tests — verify the module exports the expected surface and
// translates supabase.functions.invoke responses into Result<void>. The edge
// function's own behaviour (rate limit, validation, Resend send) is covered by
// the manual end-to-end verification in plans/ishika/landing-completion.md.
// =============================================================================

const invokeMock = vi.fn();

vi.mock('../../supabase', () => ({
  supabase: {
    functions: { invoke: invokeMock },
  },
}));

const payload = {
  name: 'Test User',
  email: 'test@example.com',
  company: 'Acme',
  message: 'Hello',
  website: '',
};

describe('contactApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports sendContactMessage', async () => {
    const api = await import('../contactApi');
    expect(typeof api.sendContactMessage).toBe('function');
  });

  it('returns ok when the function returns { ok: true }', async () => {
    invokeMock.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const api = await import('../contactApi');
    const result = await api.sendContactMessage(payload);
    expect(result.ok).toBe(true);
  });

  it('returns the error message when supabase.functions.invoke errors', async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: new Error('network down') });
    const api = await import('../contactApi');
    const result = await api.sendContactMessage(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('network down');
  });

  it('returns failure when the function returns ok: false', async () => {
    invokeMock.mockResolvedValueOnce({ data: { ok: false, error: 'Invalid email' }, error: null });
    const api = await import('../contactApi');
    const result = await api.sendContactMessage(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Invalid email');
  });

  it('returns a generic failure when the response is malformed', async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: null });
    const api = await import('../contactApi');
    const result = await api.sendContactMessage(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Submission failed');
  });

  it('forwards the payload to the contact function unchanged', async () => {
    invokeMock.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const api = await import('../contactApi');
    await api.sendContactMessage(payload);
    expect(invokeMock).toHaveBeenCalledWith('contact', { body: payload });
  });
});
