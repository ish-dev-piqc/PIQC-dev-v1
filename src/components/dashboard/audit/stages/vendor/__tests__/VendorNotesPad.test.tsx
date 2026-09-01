// VendorNotesPad (fieldwork lane, slice 1; props-driven since slice 2) —
// the vendor-audit notes pad. The workspace owns the notes and hands them
// down; the pad's mutations flow back through onNotesChange, which the Host
// harness below wires to real state so the pad behaves as in-app. Pins:
//   - a failed read renders the retry banner, never an empty pad (absence ≠
//     failure), the note COUNT is never asserted while the read is unknown,
//     and Retry asks the owner to refetch
//   - capture: Enter adds the trimmed body + positive flag, success clears the
//     editor, failure banners AND keeps the text; nothing is truncated — past
//     the drafting engine's 1,000-char read the counter says so
//   - inline edit routes through the update RPC; two-tap delete through the
//     delete RPC exactly once (the confirm control leaves before the round
//     trip); a refused delete is reported ON ITS ROW and dismissable
//   - a promoted (cited) note shows its chip and loses BOTH edit and delete
//   - hasReached=false hides every mutation surface (preview from ahead)

import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuditNoteObject } from '../../../../../../types/audit';

vi.mock('../../../../../../lib/audit/vendorNotesApi', () => ({
  createVendorNote: vi.fn(),
  updateVendorNote: vi.fn(),
  deleteVendorNote: vi.fn(),
}));

import VendorNotesPad from '../VendorNotesPad';
import {
  createVendorNote,
  deleteVendorNote,
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

const THREE = () => [note('n1'), note('n2', { is_positive: true }), note('n3', { promoted_entry_id: 'entry-9' })];

interface HostProps {
  initial?: AuditNoteObject[];
  hasReached?: boolean;
  loading?: boolean;
  loadFailed?: boolean;
  onRetry?: () => void;
}

// The workspace's role, reduced to what the pad needs: notes state plus the
// updater the pad calls.
function Host({ initial = THREE(), hasReached = true, loading = false, loadFailed = false, onRetry = () => {} }: HostProps) {
  const [notes, setNotes] = useState(initial);
  return (
    <VendorNotesPad
      auditId="audit-1"
      hasReached={hasReached}
      isLight
      notes={notes}
      loading={loading}
      loadFailed={loadFailed}
      onRetry={onRetry}
      onNotesChange={setNotes}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('load states', () => {
  it('renders the notes with positive and promoted chips; a promoted note loses edit AND delete', () => {
    render(<Host />);
    expect(screen.getByText('Note body n1')).toBeTruthy();
    expect(screen.getByTestId('vendor-notes-count').textContent).toBe('3 notes');
    expect(screen.getByTestId('vendor-note-n2').textContent).toContain('Positive');
    expect(screen.getByTestId('vendor-note-promoted-n3')).toBeTruthy();
    // The server refuses both on a cited note; neither affordance renders.
    expect(screen.queryByTestId('vendor-note-edit-n3')).toBeNull();
    expect(screen.queryByTestId('vendor-note-delete-n3')).toBeNull();
    expect(screen.getByTestId('vendor-note-edit-n1')).toBeTruthy();
    expect(screen.getByTestId('vendor-note-delete-n1')).toBeTruthy();
  });

  it('a failed read renders the retry banner and NO count, never an empty pad; Retry asks the owner', () => {
    const onRetry = vi.fn();
    render(<Host initial={[]} loadFailed onRetry={onRetry} />);
    expect(screen.getByTestId('vendor-notes-load-error')).toBeTruthy();
    // "0 notes" above "could not be loaded" would assert the very count the
    // banner disclaims.
    expect(screen.queryByTestId('vendor-notes-count')).toBeNull();
    expect(screen.queryByText(/No notes yet/)).toBeNull();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('while loading, neither the count nor the empty copy is asserted', () => {
    render(<Host initial={[]} loading />);
    expect(screen.getByText('Loading notes…')).toBeTruthy();
    expect(screen.queryByTestId('vendor-notes-count')).toBeNull();
    expect(screen.queryByText(/No notes yet/)).toBeNull();
  });
});

describe('capture', () => {
  it('Enter adds the trimmed body with the positive flag, prepends the result, and clears', async () => {
    m(createVendorNote).mockResolvedValue({
      ok: true,
      data: note('n4', { body: 'Fridge log gap 03–05 Sep', is_positive: true }),
    });
    render(<Host />);
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
    expect(screen.getByTestId('vendor-notes-count').textContent).toBe('4 notes');
    // Positive toggle resets after a save.
    expect(screen.getByTestId('vendor-notes-positive').getAttribute('aria-pressed')).toBe('false');
  });

  it('a failed save banners and keeps the text in the editor', async () => {
    m(createVendorNote).mockResolvedValue({
      ok: false,
      error: 'function audit_mode_create_vendor_note does not exist',
    });
    render(<Host />);
    const input = screen.getByTestId('vendor-notes-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Text that must survive' } });
    fireEvent.click(screen.getByTestId('vendor-notes-add'));
    const banner = await screen.findByTestId('vendor-notes-save-error');
    expect(banner.textContent).toContain('your text is still below');
    expect(banner.textContent).toContain('does not exist');
    expect(input.value).toBe('Text that must survive');
    expect(screen.getByTestId('vendor-notes-count').textContent).toBe('3 notes');
  });

  it('never truncates: past the drafting read cap the counter says so and the full text is sent', async () => {
    m(createVendorNote).mockResolvedValue({ ok: true, data: note('n5', { body: 'x'.repeat(1_200) }) });
    render(<Host />);
    const input = screen.getByTestId('vendor-notes-input') as HTMLTextAreaElement;
    expect(input.maxLength).toBe(-1);
    fireEvent.change(input, { target: { value: 'x'.repeat(1_200) } });
    expect(screen.getByTestId('vendor-notes-counter').textContent).toContain('drafting reads the first 1,000');
    fireEvent.click(screen.getByTestId('vendor-notes-add'));
    await waitFor(() =>
      expect(m(createVendorNote)).toHaveBeenCalledWith('audit-1', {
        body: 'x'.repeat(1_200),
        isPositive: false,
      }),
    );
  });

  it('disables Add on whitespace-only input', () => {
    render(<Host />);
    fireEvent.change(screen.getByTestId('vendor-notes-input'), { target: { value: '   ' } });
    expect((screen.getByTestId('vendor-notes-add') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('edit + delete', () => {
  it('inline edit routes the trimmed body and positive flag through the update RPC', async () => {
    m(updateVendorNote).mockResolvedValue({
      ok: true,
      data: note('n1', { body: 'Edited body', is_positive: true }),
    });
    render(<Host />);
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

  it('a failed edit keeps the editor open with the text and the reason', async () => {
    m(updateVendorNote).mockResolvedValue({
      ok: false,
      error: 'Note is cited by an accepted observation and cannot be edited',
    });
    render(<Host />);
    fireEvent.click(screen.getByTestId('vendor-note-edit-n1'));
    fireEvent.change(screen.getByTestId('vendor-note-edit-input-n1'), { target: { value: 'kept' } });
    fireEvent.click(screen.getByTestId('vendor-note-save-n1'));
    expect(await screen.findByText(/Edit not saved/)).toBeTruthy();
    expect((screen.getByTestId('vendor-note-edit-input-n1') as HTMLTextAreaElement).value).toBe('kept');
  });

  it('delete is two-tap, fires the RPC exactly once even on a double tap, and removes the row', async () => {
    let resolveDelete: (v: unknown) => void = () => {};
    m(deleteVendorNote).mockImplementation(
      () => new Promise((resolve) => { resolveDelete = resolve; }),
    );
    render(<Host />);
    fireEvent.click(screen.getByTestId('vendor-note-delete-n1'));
    expect(m(deleteVendorNote)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('vendor-note-delete-confirm-n1'));
    // The confirm control is gone before the round trip resolves — a second
    // tap has nothing to hit, so no "not found" error can follow a success.
    expect(screen.queryByTestId('vendor-note-delete-confirm-n1')).toBeNull();
    expect(screen.getByText('Deleting…')).toBeTruthy();
    resolveDelete({ ok: true, data: note('n1', { deleted_at: '2026-09-08T10:00:00Z' }) });
    await waitFor(() => expect(screen.queryByText('Note body n1')).toBeNull());
    expect(m(deleteVendorNote)).toHaveBeenCalledTimes(1);
    expect(m(deleteVendorNote)).toHaveBeenCalledWith('n1');
    expect(screen.getByTestId('vendor-notes-count').textContent).toBe('2 notes');
  });

  it('a refused delete is reported on its own row, keeps the row, and is dismissable', async () => {
    m(deleteVendorNote).mockResolvedValue({
      ok: false,
      error: 'Note is cited by an accepted observation and cannot be deleted',
    });
    render(<Host />);
    fireEvent.click(screen.getByTestId('vendor-note-delete-n1'));
    fireEvent.click(screen.getByTestId('vendor-note-delete-confirm-n1'));
    const rowError = await screen.findByTestId('vendor-note-delete-error-n1');
    expect(rowError.textContent).toContain('Not deleted');
    expect(rowError.textContent).toContain('cannot be deleted');
    expect(screen.getByText('Note body n1')).toBeTruthy();
    // Not attached to any other row.
    expect(screen.queryByTestId('vendor-note-delete-error-n2')).toBeNull();
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByTestId('vendor-note-delete-error-n1')).toBeNull();
  });
});

describe('preview from ahead', () => {
  it('hides capture, edit, and delete when the stage is not reached — notes stay readable', () => {
    render(<Host hasReached={false} />);
    expect(screen.getByText('Note body n1')).toBeTruthy();
    expect(screen.queryByTestId('vendor-notes-capture')).toBeNull();
    expect(screen.queryByTestId('vendor-note-edit-n1')).toBeNull();
    expect(screen.queryByTestId('vendor-note-delete-n1')).toBeNull();
  });
});
