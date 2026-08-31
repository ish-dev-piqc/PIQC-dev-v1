// PR-UX2 — one-ahead preview guard for ISA Stage 5 (fieldwork). Previewing
// from ISA_PREP used to leave note capture, edits, agentic drafting, and
// accept-as-finding live. Fieldwork records what happened on site, so the
// preview must be read-only. Mock idiom follows the vendor stage tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

let mockActiveAudit = {
  id: 'audit-1',
  workflow_type: 'INVESTIGATOR_SITE_AUDIT',
  current_stage: 'ISA_CONDUCT',
};
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({ activeAudit: mockActiveAudit }),
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
});
