import { beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// orgsApi — smoke tests verifying the public surface + buildInviteUrl shape.
// Full RPC behaviour is covered by the migrations' verification blocks +
// manual test plan in plans/kiara/org-workspaces.md.
//
// Supabase client is mocked so importing the module doesn't require env vars.
// =============================================================================

vi.mock('../../supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: undefined,
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

// crypto.randomUUID is available natively in the vitest runtime — no stub
// needed. inviteGuest exercises it; none of these tests assert the UUID
// value so the real implementation is fine.

describe('orgsApi public surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the org-level helpers', async () => {
    const m = await import('../orgsApi');
    expect(typeof m.fetchCurrentUserOrg).toBe('function');
    expect(typeof m.listMyOrgs).toBe('function');
    expect(typeof m.listOrgMembersWithProfile).toBe('function');
    expect(typeof m.currentUserIsOrgAdmin).toBe('function');
    expect(typeof m.updateOrgMemberRole).toBe('function');
    expect(typeof m.removeOrgMember).toBe('function');
  });

  it('exports the org-invites helpers (legacy + new)', async () => {
    const m = await import('../orgsApi');
    expect(typeof m.createOrgInvite).toBe('function');
    expect(typeof m.acceptOrgInvite).toBe('function');
    expect(typeof m.listOrgInvites).toBe('function');
    expect(typeof m.revokeOrgInvite).toBe('function');
    expect(typeof m.buildInviteUrl).toBe('function');
  });

  it('exports the protocol-members helpers', async () => {
    const m = await import('../orgsApi');
    expect(typeof m.listProtocolMembers).toBe('function');
    expect(typeof m.listMyProtocolMemberships).toBe('function');
    expect(typeof m.addProtocolMember).toBe('function');
    expect(typeof m.updateProtocolMemberRole).toBe('function');
    expect(typeof m.removeProtocolMember).toBe('function');
  });

  it('exports the access-requests helpers', async () => {
    const m = await import('../orgsApi');
    expect(typeof m.listMyAccessRequests).toBe('function');
    expect(typeof m.listProtocolAccessRequests).toBe('function');
    expect(typeof m.createAccessRequest).toBe('function');
    expect(typeof m.withdrawAccessRequest).toBe('function');
    expect(typeof m.denyAccessRequest).toBe('function');
    expect(typeof m.approveAccessRequest).toBe('function');
  });

  it('exports the guest helpers', async () => {
    const m = await import('../orgsApi');
    expect(typeof m.listProtocolGuests).toBe('function');
    expect(typeof m.inviteGuest).toBe('function');
    expect(typeof m.revokeGuest).toBe('function');
    expect(typeof m.acceptGuestInvite).toBe('function');
  });

  it('exports listProtocolsByOrg for the invite-form picker', async () => {
    const m = await import('../orgsApi');
    expect(typeof m.listProtocolsByOrg).toBe('function');
  });
});

describe('buildInviteUrl', () => {
  it('encodes the token into a query param off the app root', async () => {
    const { buildInviteUrl } = await import('../orgsApi');
    const url = buildInviteUrl('abc 123');
    // Either runs under jsdom (with window) or SSR-safe path (origin empty).
    expect(url).toMatch(/\?invite=abc(%20|\+)123$/);
  });
});

describe('approveAccessRequest', () => {
  it('returns a Result-shape error when the RPC reports !ok', async () => {
    const supabaseModule = await import('../../supabase');
    const rpcSpy = vi
      .spyOn(supabaseModule.supabase, 'rpc')
      .mockResolvedValueOnce({
        data: { ok: false, error: 'not_a_coordinator' },
        error: null,
      } as never);

    const { approveAccessRequest } = await import('../orgsApi');
    const res = await approveAccessRequest('req-1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('not_a_coordinator');
    expect(rpcSpy).toHaveBeenCalledWith('approve_protocol_access_request', {
      p_request_id: 'req-1',
    });
  });
});
