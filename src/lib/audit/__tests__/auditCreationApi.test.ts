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

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOrder, mockRpc } = vi.hoisted(() => ({
  mockOrder: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('../../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ order: mockOrder })),
    })),
    rpc: mockRpc,
  },
}));

import { listVendors, createAudit } from '../auditCreationApi';

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
