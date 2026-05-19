import { describe, expect, it, vi, beforeEach } from 'vitest';

// =============================================================================
// orgApi smoke tests — verify the module exports the expected surface and
// that buildInviteUrl is correct. Full RPC behaviour is covered by the
// Supabase migration's verification block in
// 20260520010000_org_invites_table_and_rpcs.sql + manual test plan.
// =============================================================================

// Mock the supabase client so importing orgApi doesn't require env vars.
vi.mock('../../supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

describe('orgApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the expected public surface', async () => {
    const api = await import('../orgApi');
    expect(typeof api.fetchCurrentUserOrg).toBe('function');
    expect(typeof api.listOrgMembers).toBe('function');
    expect(typeof api.currentUserIsOrgAdmin).toBe('function');
    expect(typeof api.createOrgInvite).toBe('function');
    expect(typeof api.acceptOrgInvite).toBe('function');
    expect(typeof api.listOrgInvites).toBe('function');
    expect(typeof api.updateOrgMemberRole).toBe('function');
    expect(typeof api.removeOrgMember).toBe('function');
    expect(typeof api.buildInviteUrl).toBe('function');
  });

  it('buildInviteUrl produces a URL with the token URL-encoded', async () => {
    const api = await import('../orgApi');
    // jsdom default location is http://localhost:3000/
    const url = api.buildInviteUrl('abc123');
    expect(url).toMatch(/\?invite=abc123$/);
    // Special chars get encoded
    const encoded = api.buildInviteUrl('a/b+c');
    expect(encoded).toMatch(/\?invite=a%2Fb%2Bc$/);
  });

  it('fetchCurrentUserOrg returns null when profile has no org_id', async () => {
    const api = await import('../orgApi');
    const result = await api.fetchCurrentUserOrg();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });
});
