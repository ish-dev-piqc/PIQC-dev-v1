// Unit tests for ParticipantProfileDrawer's delete flow.
//
// Regression guard for SIT-M1: on a FAILED delete, the soft-confirm panel
// must stay mounted so the deleteError banner renders where the user is
// already looking. The bug was handleDelete calling setConfirmingDelete(false)
// in the failure branch, which unmounted the block that renders {deleteError}.
// Mirror of VisitDetailDrawer.handleCancelVisit: collapse the panel only on
// the success path.
//
// vitest runs with globals:false and RTL auto-cleanup isn't registered, so we
// unmount between cases ourselves (matches VisitConfidenceChip.test.tsx).
//
// Mock surface: siteApi.deleteParticipant (the mutation under test) plus the
// context/hook dependencies the drawer pulls in at module scope. We only stub
// what's needed to render — the delete panel is pure local state on top of the
// mutation result, so nothing else is exercised.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SiteParticipant } from '../../../../lib/site/types';

const PARTICIPANT: SiteParticipant = {
  id: 'P-0023',
  uuid: '11111111-1111-1111-1111-111111111111',
  protocol_id: 'proto-1',
  status: 'ACTIVE',
  enrolled_at: '2026-01-10',
  current_study_day: 14,
  next_visit_date: null,
  next_visit_name: null,
  assigned_coordinator: 'Coordinator A',
  open_deviations: 0,
  notes: null,
};

const mockRefresh = vi.fn();

vi.mock('../../../../lib/site/siteApi', () => ({
  deleteParticipant: vi.fn(),
  updateParticipant: vi.fn(),
}));

vi.mock('../../../../context/SiteDataContext', () => ({
  useSiteData: () => ({
    participants: [PARTICIPANT],
    visits: [],
    refresh: mockRefresh,
  }),
}));

vi.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

vi.mock('../../../../context/OrgContext', () => ({
  useOrg: () => ({ activeOrg: null }),
}));

vi.mock('../../../../context/ChatNavigationContext', () => ({
  useChatNavigation: () => ({ navigateToOrgChat: vi.fn() }),
}));

vi.mock('../../../../hooks/useOverlay', () => ({ useOverlay: () => {} }));
vi.mock('../../../../hooks/useSwipeDismiss', () => ({ useSwipeDismiss: () => ({}) }));

// Decisions fetch: resolve empty so the timeline renders with visits alone.
vi.mock('../../../../lib/orgs/orgsApi', () => ({
  listDecisionsReferencingParticipant: vi.fn().mockResolvedValue({ ok: true, data: [] }),
}));

import ParticipantProfileDrawer from '../ParticipantProfileDrawer';
import { deleteParticipant } from '../../../../lib/site/siteApi';

const mockDelete = deleteParticipant as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

function renderDrawer(onClose = vi.fn()) {
  render(
    <ParticipantProfileDrawer
      participantId={PARTICIPANT.id}
      protocols={[]}
      onClose={onClose}
    />,
  );
  return onClose;
}

describe('ParticipantProfileDrawer — delete flow (SIT-M1)', () => {
  it('keeps the confirm panel mounted and shows the error when delete fails', async () => {
    const user = userEvent.setup();
    mockDelete.mockResolvedValue({ ok: false, error: 'Delete blocked by policy' });
    const onClose = renderDrawer();

    // Open the soft-confirm panel.
    await user.click(screen.getByRole('button', { name: 'Delete participant' }));
    expect(screen.getByText(`Delete ${PARTICIPANT.id}?`)).toBeInTheDocument();

    // Confirm the delete — the mutation fails.
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    // The error banner renders...
    expect(await screen.findByText('Delete blocked by policy')).toBeInTheDocument();
    // ...because the confirm panel is STILL mounted (the bug unmounted it).
    expect(screen.getByText(`Delete ${PARTICIPANT.id}?`)).toBeInTheDocument();
    // Failed delete must not close the drawer.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the drawer on a successful delete', async () => {
    const user = userEvent.setup();
    mockDelete.mockResolvedValue({ ok: true, data: undefined });
    const onClose = renderDrawer();

    await user.click(screen.getByRole('button', { name: 'Delete participant' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
