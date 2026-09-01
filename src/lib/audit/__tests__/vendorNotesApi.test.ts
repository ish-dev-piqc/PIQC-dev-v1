// vendorNotesApi (fieldwork lane, slice 1) — the vendor sibling of
// isaNotesApi. Pins: routing to the VENDOR RPCs (never the ISA ones), the
// arg/default mapping the RPC signatures rely on, leave-alone null semantics
// on update, Result error mapping, and the soft-delete read filter.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditNoteObject } from '../../../types/audit';

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

import { supabase } from '../../supabase';
import {
  createVendorNote,
  deleteVendorNote,
  fetchVendorNotes,
  updateVendorNote,
} from '../vendorNotesApi';

const rpcMock = vi.mocked(supabase.rpc);
const fromMock = vi.mocked(supabase.from);

function makeNote(overrides: Partial<AuditNoteObject> = {}): AuditNoteObject {
  return {
    id: 'note-1',
    audit_id: 'audit-1',
    body: 'Validation SOP-014 rev 3 not signed; rev 2 still in use at the bench',
    isa_domain: null,
    is_positive: false,
    deleted_at: null,
    promoted_finding_id: null,
    promoted_entry_id: null,
    created_by: 'user-1',
    created_at: '2026-09-08T09:30:00Z',
    updated_at: '2026-09-08T09:30:00Z',
    ...overrides,
  };
}

function mockSelectChain(result: { data: unknown; error: { message: string } | null }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.order.mockResolvedValue(result);
  fromMock.mockReturnValue(chain as never);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchVendorNotes', () => {
  it('reads live notes newest-first and filters soft-deleted rows server-side', async () => {
    const note = makeNote();
    const chain = mockSelectChain({ data: [note], error: null });

    const res = await fetchVendorNotes('audit-1');

    expect(fromMock).toHaveBeenCalledWith('audit_note_objects');
    expect(chain.eq).toHaveBeenCalledWith('audit_id', 'audit-1');
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(res).toEqual({ ok: true, data: [note] });
  });

  it('maps a select error to ok:false (absence ≠ failure for the caller)', async () => {
    mockSelectChain({ data: null, error: { message: 'permission denied' } });
    expect(await fetchVendorNotes('audit-1')).toEqual({ ok: false, error: 'permission denied' });
  });
});

describe('createVendorNote', () => {
  it('routes to the VENDOR create RPC with is_positive defaulted false and no domain param', async () => {
    const note = makeNote();
    rpcMock.mockResolvedValue({ data: note, error: null } as never);

    const res = await createVendorNote('audit-1', { body: note.body });

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_create_vendor_note', {
      p_audit_id: 'audit-1',
      p_body: note.body,
      p_is_positive: false,
    });
    expect(res).toEqual({ ok: true, data: note });
  });

  it('passes a positive observation through', async () => {
    rpcMock.mockResolvedValue({ data: makeNote({ is_positive: true }), error: null } as never);
    await createVendorNote('audit-1', { body: 'Training matrix current for all bench staff', isPositive: true });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_is_positive: true });
  });

  it('maps an RPC error to ok:false — the pre-apply "function does not exist" path included', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'function audit_mode_create_vendor_note does not exist' },
    } as never);
    expect(await createVendorNote('audit-1', { body: 'x' })).toEqual({
      ok: false,
      error: 'function audit_mode_create_vendor_note does not exist',
    });
  });
});

describe('updateVendorNote', () => {
  it('sends null for omitted fields (leave-alone semantics)', async () => {
    const note = makeNote({ is_positive: true });
    rpcMock.mockResolvedValue({ data: note, error: null } as never);

    const res = await updateVendorNote('note-1', { isPositive: true });

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_update_vendor_note', {
      p_id: 'note-1',
      p_body: null,
      p_is_positive: true,
    });
    expect(res).toEqual({ ok: true, data: note });
  });

  it('sends an edited body with is_positive left alone', async () => {
    rpcMock.mockResolvedValue({ data: makeNote({ body: 'edited' }), error: null } as never);
    await updateVendorNote('note-1', { body: 'edited' });
    expect(rpcMock).toHaveBeenCalledWith('audit_mode_update_vendor_note', {
      p_id: 'note-1',
      p_body: 'edited',
      p_is_positive: null,
    });
  });
});

describe('deleteVendorNote', () => {
  it('soft-deletes via the vendor RPC and returns the tombstoned row', async () => {
    const note = makeNote({ deleted_at: '2026-09-08T10:00:00Z' });
    rpcMock.mockResolvedValue({ data: note, error: null } as never);

    const res = await deleteVendorNote('note-1');

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_delete_vendor_note', { p_id: 'note-1' });
    expect(res).toEqual({ ok: true, data: note });
  });

  it('surfaces the promoted-note refusal as ok:false', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Note is cited by an observation and cannot be deleted' },
    } as never);
    expect(await deleteVendorNote('note-1')).toEqual({
      ok: false,
      error: 'Note is cited by an observation and cannot be deleted',
    });
  });
});
