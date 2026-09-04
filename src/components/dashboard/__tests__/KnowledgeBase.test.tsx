// KnowledgeBase — DocumentList ownership gate.
// RLS lets a lead auditor READ the protocol document they audit, but DELETE is
// owner-only, so a delete on a non-owned row silently removes 0 rows. The list
// must therefore show the delete control only on rows the signed-in user owns.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { DOCS, deleteEq } = vi.hoisted(() => ({
  DOCS: [
    {
      id: 'doc-own',
      title: 'My protocol',
      filename: 'mine.pdf',
      created_at: '2026-09-01T00:00:00Z',
      status: 'ready',
      error_message: null,
      user_id: 'user-me',
    },
    {
      id: 'doc-shared',
      title: 'Audited protocol',
      filename: 'theirs.pdf',
      created_at: '2026-09-02T00:00:00Z',
      status: 'ready',
      error_message: null,
      user_id: 'user-uploader',
    },
  ],
  deleteEq: vi.fn(() => Promise.resolve({ error: null })),
}));

vi.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-me' } }),
}));

// Chainable stub keyed by table: documents → list + delete; chunks → counts.
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) =>
      table === 'documents'
        ? {
            select: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: DOCS }),
              }),
            }),
            delete: () => ({ eq: deleteEq }),
          }
        : {
            select: () => ({
              in: () => Promise.resolve({ data: [] }),
            }),
          },
  },
}));

import KnowledgeBase from '../KnowledgeBase';

describe('KnowledgeBase document list', () => {
  it('shows a delete control only on documents the signed-in user owns', async () => {
    render(<KnowledgeBase />);

    expect(await screen.findByText('My protocol')).toBeTruthy();
    expect(screen.getByText('Audited protocol')).toBeTruthy();

    expect(screen.getByRole('button', { name: 'Delete My protocol' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete Audited protocol' })).toBeNull();
  });

  it('still deletes an owned document', async () => {
    render(<KnowledgeBase />);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete My protocol' }));

    await waitFor(() => expect(screen.queryByText('My protocol')).toBeNull());
    expect(deleteEq).toHaveBeenCalledWith('id', 'doc-own');
    expect(screen.getByText('Audited protocol')).toBeTruthy();
  });
});
