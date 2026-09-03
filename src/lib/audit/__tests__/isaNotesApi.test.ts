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
  createIsaNote,
  deleteIsaNote,
  fetchIsaNotes,
  updateIsaNote,
} from '../isaNotesApi';

const rpcMock = vi.mocked(supabase.rpc);
const fromMock = vi.mocked(supabase.from);

function makeNote(overrides: Partial<AuditNoteObject> = {}): AuditNoteObject {
  return {
    id: 'note-1',
    audit_id: 'audit-1',
    body: 'Subj 003 ICF v2 signed after v3 approval',
    isa_domain: 'INFORMED_CONSENT',
    is_positive: false,
    deleted_at: null,
    promoted_finding_id: null,
    promoted_entry_id: null,
    created_by: 'user-1',
    created_at: '2026-07-19T14:30:00Z',
    updated_at: '2026-07-19T14:30:00Z',
    ...overrides,
  };
}

// Chainable stand-in for .from('audit_note_objects').select().eq().is().order()
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

describe('fetchIsaNotes', () => {
  it('returns live notes and filters soft-deleted rows server-side', async () => {
    const note = makeNote();
    const chain = mockSelectChain({ data: [note], error: null });

    const res = await fetchIsaNotes('audit-1');

    expect(fromMock).toHaveBeenCalledWith('audit_note_objects');
    expect(chain.eq).toHaveBeenCalledWith('audit_id', 'audit-1');
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(res).toEqual({ ok: true, data: [note] });
  });

  it('maps a select error to ok:false', async () => {
    mockSelectChain({ data: null, error: { message: 'permission denied' } });

    const res = await fetchIsaNotes('audit-1');

    expect(res).toEqual({ ok: false, error: 'permission denied' });
  });
});

describe('createIsaNote', () => {
  it('calls the RPC with defaults for omitted fields', async () => {
    const note = makeNote({ isa_domain: null });
    rpcMock.mockResolvedValue({ data: note, error: null } as never);

    const res = await createIsaNote('audit-1', { body: 'IP fridge log gap 03–05 Mar' });

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_create_isa_note', {
      p_audit_id: 'audit-1',
      p_body: 'IP fridge log gap 03–05 Mar',
      p_isa_domain: null,
      p_is_positive: false,
    });
    expect(res).toEqual({ ok: true, data: note });
  });

  it('maps an RPC error to ok:false', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Notes are only available on investigator site audits' },
    } as never);

    const res = await createIsaNote('audit-1', { body: 'x' });

    expect(res).toEqual({
      ok: false,
      error: 'Notes are only available on investigator site audits',
    });
  });
});

describe('updateIsaNote', () => {
  it('passes the clear flag and leaves omitted fields null (leave-alone semantics)', async () => {
    const note = makeNote({ isa_domain: null });
    rpcMock.mockResolvedValue({ data: note, error: null } as never);

    const res = await updateIsaNote('note-1', { clearIsaDomain: true });

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_update_isa_note', {
      p_id: 'note-1',
      p_body: null,
      p_isa_domain: null,
      p_clear_isa_domain: true,
      p_is_positive: null,
    });
    expect(res).toEqual({ ok: true, data: note });
  });

  it('sends a re-tag without clearing', async () => {
    const note = makeNote({ isa_domain: 'INVESTIGATIONAL_PRODUCT' });
    rpcMock.mockResolvedValue({ data: note, error: null } as never);

    await updateIsaNote('note-1', { isaDomain: 'INVESTIGATIONAL_PRODUCT', isPositive: true });

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_update_isa_note', {
      p_id: 'note-1',
      p_body: null,
      p_isa_domain: 'INVESTIGATIONAL_PRODUCT',
      p_clear_isa_domain: false,
      p_is_positive: true,
    });
  });
});

describe('deleteIsaNote', () => {
  it('soft-deletes via RPC and returns the tombstoned row', async () => {
    const note = makeNote({ deleted_at: '2026-07-19T15:00:00Z' });
    rpcMock.mockResolvedValue({ data: note, error: null } as never);

    const res = await deleteIsaNote('note-1');

    expect(rpcMock).toHaveBeenCalledWith('audit_mode_delete_isa_note', { p_id: 'note-1' });
    expect(res).toEqual({ ok: true, data: note });
  });

  it('maps an RPC error to ok:false', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Note x not found' } } as never);

    const res = await deleteIsaNote('note-1');

    expect(res).toEqual({ ok: false, error: 'Note x not found' });
  });
});
