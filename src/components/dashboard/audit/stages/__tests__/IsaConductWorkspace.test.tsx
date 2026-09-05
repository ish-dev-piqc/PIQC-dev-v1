// PR-UX2 — one-ahead preview guard for ISA Stage 5 (fieldwork). Previewing
// from ISA_PREP used to leave note capture, edits, agentic drafting, and
// accept-as-finding live. Fieldwork records what happened on site, so the
// preview must be read-only. Mock idiom follows the vendor stage tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const mockAdvanceStage = vi.fn();
let mockActiveAudit = {
  id: 'audit-1',
  workflow_type: 'INVESTIGATOR_SITE_AUDIT',
  current_stage: 'ISA_CONDUCT',
};
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
  }),
}));

vi.mock('../../../../../lib/audit/isaNotesApi', () => ({
  createIsaNote: vi.fn(),
  deleteIsaNote: vi.fn(),
  fetchIsaNotes: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
  updateIsaNote: vi.fn(),
}));

vi.mock('../../../../../lib/audit/isaFindingsApi', () => ({
  createIsaFinding: vi.fn(),
  fetchIsaFindings: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
  fetchIsaProtocolBridgeStatus: vi.fn(() => Promise.resolve({ ok: true, data: 0 })),
  requestIsaFindingDrafts: vi.fn(),
  searchIsaProtocolChunks: vi.fn(),
  updateIsaFinding: vi.fn(),
}));

// Presentation-only side view; not under test.
vi.mock('../investigator/IsaClosingMeetingView', () => ({ default: () => null }));

import IsaConductWorkspace from '../investigator/IsaConductWorkspace';
import { fetchIsaNotes } from '../../../../../lib/audit/isaNotesApi';

const mockFetchNotes = fetchIsaNotes as ReturnType<typeof vi.fn>;

describe('IsaConductWorkspace — one-ahead preview guard (PR-UX2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchNotes.mockResolvedValue({ ok: true, data: [] });
  });

  it('PREVIEW (audit at ISA_PREP): notice up, capture section hidden', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'ISA_PREP' };

    render(<IsaConductWorkspace />);

    await waitFor(() => expect(mockFetchNotes).toHaveBeenCalledWith('audit-1'));
    expect(screen.getByText(/has not reached this stage yet/i)).toBeInTheDocument();
    expect(screen.queryByText('New note')).not.toBeInTheDocument();
  });

  it('AT STAGE: capture section renders, no preview notice', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'ISA_CONDUCT' };

    render(<IsaConductWorkspace />);

    await waitFor(() => expect(screen.getByText('New note')).toBeInTheDocument());
    expect(screen.queryByText(/has not reached this stage yet/i)).not.toBeInTheDocument();
  });

  it('AT STAGE with no parsed protocol: the nudge points at Stage 1, not a "library"', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'ISA_CONDUCT' };

    render(<IsaConductWorkspace />);

    await waitFor(() =>
      expect(screen.getByText(/check Stage 1 \(Site intake\)/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/in the library/)).not.toBeInTheDocument();
  });
});

// isa-placeholder-advance: Stage 5 carries the shared StageTransitionCard
// toward Report drafting. The card's own states are pinned in
// StageTransitionCard.test.tsx; here: the mount, the target stage, and the
// one-ahead preview leaving it disabled.
describe('IsaConductWorkspace — Stage 5 → Report drafting card (isa-placeholder-advance)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchNotes.mockResolvedValue({ ok: true, data: [] });
  });

  it('AT STAGE: "Advance to Report drafting" is enabled and advances to ISA_REPORT', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'ISA_CONDUCT' };

    render(<IsaConductWorkspace />);

    await waitFor(() => expect(screen.getByText('New note')).toBeInTheDocument());
    const button = screen.getByRole('button', { name: 'Advance to Report drafting' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(mockAdvanceStage).toHaveBeenCalledTimes(1);
    expect(mockAdvanceStage).toHaveBeenCalledWith('ISA_REPORT');
  });

  it('PREVIEW (audit at ISA_PREP): the card is ahead of the audit, button disabled', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'ISA_PREP' };

    render(<IsaConductWorkspace />);

    await waitFor(() => expect(mockFetchNotes).toHaveBeenCalledWith('audit-1'));
    expect(screen.getByText('Advance from Audit prep first.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Advance to Report drafting' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockAdvanceStage).not.toHaveBeenCalled();
  });
});
