// VendorNotesPad (fieldwork lane, slice 1) — the vendor-audit notes pad.
// Pins the honesty contracts the pad owns:
//   - load failure renders the retry banner, never an empty pad (absence ≠
//     failure), and Retry refetches
//   - capture: Enter adds the trimmed body + positive flag, success clears the
//     editor, failure banners AND keeps the text
//   - the 1,000-char cap is enforced at the input (slice 2's engine cap)
//   - inline edit routes through the update RPC; two-tap delete through the
//     delete RPC; a promoted note shows its chip and hides Delete
//   - hasReached=false hides every mutation surface (preview from ahead)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuditNoteObject } from '../../../../../../types/audit';

vi.mock('../../../../../../lib/audit/vendorNotesApi', () => ({
  fetchVendorNotes: vi.fn(),
  createVendorNote: vi.fn(),
  updateVendorNote: vi.fn(),
  deleteVendorNote: vi.fn(),
}));

import VendorNotesPad from '../VendorNotesPad';
import {
  createVendorNote,
  deleteVendorNote,
  fetchVendorNotes,
  updateVendorNote,
} from '../../../../../../lib/audit/vendorNotesApi';

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function note(id: string, overrides: Partial<AuditNoteObject> = {}): AuditNoteObject {
  return {
    id,
    audit_id: 'audit-1',
    body: `Note body ${id}`,
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

function renderPad(overrides: Partial<{ hasReached: boolean }> = {}) {
  return render(
    <VendorNotesPad auditId="audit-1" hasReached={overrides.hasReached ?? true} isLight />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m(fetchVendorNotes).mockResolvedValue({
    ok: true,
    data: [note('n1'), note('n2', { is_positive: true }), note('n3', { promoted_entry_id: 'entry-9' })],
  });
});

describe('load', () => {
  it('renders the notes with positive and promoted chips', async () => {
    renderPad();
    expect(await screen.findByText('Note body n1')).toBeTruthy();
    expect(screen.getByText('3 notes')).toBeTruthy();
    expect(screen.getByTestId('vendor-note-n2').textContent).toContain('Positive');
    expect(screen.getByTestId('vendor-note-promoted-n3')).toBeTruthy();
    // A promoted note keeps Edit but loses Delete (the server refuses it).
    expect(screen.getByTestId('vendor-note-edit-n3')).toBeTruthy();
    expect(screen.queryByTestId('vendor-note-delete-n3')).toBeNull();
    expect(screen.getByTestId('vendor-note-delete-n1')).toBeTruthy();
  });

  it('a failed read renders the retry banner, never an empty pad, and Retry refetches', async () => {
    m(fetchVendorNotes).mockResolvedValueOnce({ ok: false, error: 'permission denied' });
    renderPad();
    expect(await screen.findByTestId('vendor-notes-load-error')).toBeTruthy();
    expect(screen.queryByText(/No notes yet/)).toBeNull();
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByText('Note body n1')).toBeTruthy();
    expect(m(fetchVendorNotes)).toHaveBeenCalledTimes(2);
  });
});

describe('capture', () => {
  it('Enter adds the trimmed body with the positive flag, prepends the result, and clears', async () => {
    m(createVendorNote).mockResolvedValue({
      ok: true,
      data: note('n4', { body: 'Fridge log gap 03–05 Sep', is_positive: true }),
    });
    renderPad();
    await screen.findByText('Note body n1');
    fireEvent.click(screen.getByTestId('vendor-notes-positive'));
    const input = screen.getByTestId('vendor-notes-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '  Fridge log gap 03–05 Sep  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(m(createVendorNote)).toHaveBeenCalledWith('audit-1', {
        body: 'Fridge log gap 03–05 Sep',
        isPositive: true,
      }),
    );
    expect(await screen.findByText('Fridge log gap 03–05 Sep')).toBeTruthy();
    expect(input.value).toBe('');
    expect(screen.getByText('4 notes')).toBeTruthy();
    // Positive toggle resets after a save.
    expect(screen.getByTestId('vendor-notes-positive').getAttribute('aria-pressed')).toBe('false');
  });

  it('a failed save banners and keeps the text in the editor', async () => {
    m(createVendorNote).mockResolvedValue({
      ok: false,
      error: 'function audit_mode_create_vendor_note does not exist',
    });
    renderPad();
    await screen.findByText('Note body n1');
    const input = screen.getByTestId('vendor-notes-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Text that must survive' } });
    fireEvent.click(screen.getByTestId('vendor-notes-add'));
    const banner = await screen.findByTestId('vendor-notes-save-error');
    expect(banner.textContent).toContain('your text is still below');
    expect(banner.textContent).toContain('does not exist');
    expect(input.value).toBe('Text that must survive');
    expect(screen.getByText('3 notes')).toBeTruthy();
  });

  it('enforces the 1,000-character cap at the input and disables Add on whitespace', async () => {
    renderPad();
    await screen.findByText('Note body n1');
    const input = screen.getByTestId('vendor-notes-input') as HTMLTextAreaElement;
    expect(input.maxLength).toBe(1000);
    fireEvent.change(input, { target: { value: '   ' } });
    expect((screen.getByTestId('vendor-notes-add') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('edit + delete', () => {
  it('inline edit routes the trimmed body and positive flag through the update RPC', async () => {
    m(updateVendorNote).mockResolvedValue({
      ok: true,
      data: note('n1', { body: 'Edited body', is_positive: true }),
    });
    renderPad();
    await screen.findByText('Note body n1');
    fireEvent.click(screen.getByTestId('vendor-note-edit-n1'));
    fireEvent.change(screen.getByTestId('vendor-note-edit-input-n1'), {
      target: { value: '  Edited body  ' },
    });
    fireEvent.click(screen.getByTestId('vendor-note-edit-positive-n1'));
    fireEvent.click(screen.getByTestId('vendor-note-save-n1'));
    await waitFor(() =>
      expect(m(updateVendorNote)).toHaveBeenCalledWith('n1', {
        body: 'Edited body',
        isPositive: true,
      }),
    );
    expect(await screen.findByText('Edited body')).toBeTruthy();
  });

  it('delete is two-tap and removes the row on success', async () => {
    m(deleteVendorNote).mockResolvedValue({
      ok: true,
      data: note('n1', { deleted_at: '2026-09-08T10:00:00Z' }),
    });
    renderPad();
    await screen.findByText('Note body n1');
    fireEvent.click(screen.getByTestId('vendor-note-delete-n1'));
    expect(m(deleteVendorNote)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('vendor-note-delete-confirm-n1'));
    await waitFor(() => expect(m(deleteVendorNote)).toHaveBeenCalledWith('n1'));
    await waitFor(() => expect(screen.queryByText('Note body n1')).toBeNull());
    expect(screen.getByText('2 notes')).toBeTruthy();
  });

  it('a refused delete surfaces the server reason and keeps the row', async () => {
    m(deleteVendorNote).mockResolvedValue({
      ok: false,
      error: 'Note is cited by an observation and cannot be deleted',
    });
    renderPad();
    await screen.findByText('Note body n1');
    fireEvent.click(screen.getByTestId('vendor-note-delete-n1'));
    fireEvent.click(screen.getByTestId('vendor-note-delete-confirm-n1'));
    const banner = await screen.findByTestId('vendor-notes-delete-error');
    expect(banner.textContent).toContain('cannot be deleted');
    expect(screen.getByText('Note body n1')).toBeTruthy();
  });
});

describe('preview from ahead', () => {
  it('hides capture, edit, and delete when the stage is not reached — notes stay readable', async () => {
    renderPad({ hasReached: false });
    expect(await screen.findByText('Note body n1')).toBeTruthy();
    expect(screen.queryByTestId('vendor-notes-capture')).toBeNull();
    expect(screen.queryByTestId('vendor-note-edit-n1')).toBeNull();
    expect(screen.queryByTestId('vendor-note-delete-n1')).toBeNull();
  });
});
