// PR-UX2 — one-ahead preview guard for Stage 6. Previewing from Stage 5 used
// to leave "New entry" and the advance button live — the advance fired a +2
// jump the server rejects (dead click), and observations could be recorded
// for conduct that hadn't happened. Mock idiom follows
// ReportDraftingWorkspace.test.tsx; the SOTR drawers are stubbed shallow so
// the test doesn't pull the SOTR tree.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MockWorkspaceEntry } from '../../../../../lib/audit/mockWorkspaceEntries';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const BASE_AUDIT = {
  id: 'audit-1',
  protocol_id: 'proto-1',
  protocol_code: 'PIQC-001',
  workflow_type: 'VENDOR_AUDIT',
  current_stage: 'AUDIT_CONDUCT',
};
// Tests mutate this per case; beforeEach restores it so no test inherits a
// neighbour's stage.
let mockActiveAudit = { ...BASE_AUDIT };
const mockAdvanceStage = vi.fn();
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
  }),
}));

let mockEntries: Record<string, MockWorkspaceEntry[]> = {};
const mockSetWorkspaceEntries = vi.fn();
vi.mock('../../../../../context/AuditDataContext', () => ({
  useAuditData: () => ({
    workspaceEntries: mockEntries,
    setWorkspaceEntries: mockSetWorkspaceEntries,
    protocolRisks: {},
  }),
}));

vi.mock('../../../../../lib/audit/workspaceEntriesApi', () => ({
  fetchWorkspaceEntries: vi.fn(() => Promise.resolve([])),
  createWorkspaceEntry: vi.fn(),
  updateWorkspaceEntry: vi.fn(),
}));

// The ONE notes read (slice 2) — the workspace owns it and hands the notes
// to both the pad and the candidate panel.
const mockFetchVendorNotes = vi.fn();
vi.mock('../../../../../lib/audit/vendorNotesApi', () => ({
  fetchVendorNotes: (...args: unknown[]) => mockFetchVendorNotes(...args),
}));

// SOTR drawers are cross-surface heavies; the preview test only needs them
// to mount as nothing.
vi.mock('../../../../sotr/SourceTruthListDrawer', () => ({ default: () => null }));
vi.mock('../../../../sotr/SourceTruthDrawer', () => ({ default: () => null }));
vi.mock('../../../../sotr/WorksheetItemRow', () => ({
  formatExtractedValue: () => '',
}));

// The notes pad and the candidate panel have their own suites under
// vendor/__tests__/; here they mount as markers that echo the props they were
// handed. The panel marker exposes a button that simulates an accepted
// candidate so the workspace's merge can be pinned.
vi.mock('../vendor/VendorNotesPad', () => ({
  default: ({ hasReached, notes, status, onRetry }: {
    hasReached: boolean;
    notes: { promoted_entry_id: string | null }[];
    status: string;
    onRetry: () => void;
  }) => (
    <div
      data-testid="vendor-notes-pad"
      data-reached={String(hasReached)}
      data-notes={String(notes.length)}
      data-status={status}
    >
      <button type="button" onClick={onRetry}>
        retry notes
      </button>
    </div>
  ),
}));
vi.mock('../vendor/VendorCandidatePanel', () => ({
  default: ({ hasReached, notes, notesStatus, onPromoted }: {
    hasReached: boolean;
    notes: unknown[];
    notesStatus: string;
    onPromoted: (entry: MockWorkspaceEntry, consumedNoteIds: string[]) => void;
  }) => (
    <div
      data-testid="vendor-candidate-panel"
      data-reached={String(hasReached)}
      data-notes={String(notes.length)}
      data-notes-status={notesStatus}
    >
      <button type="button" onClick={() => onPromoted({ ...makeEntry(), id: 'entry-promoted' }, ['note-1'])}>
        simulate accept
      </button>
    </div>
  ),
}));

import AuditConductWorkspace from '../AuditConductWorkspace';

function makeNote(id: string) {
  return {
    id,
    audit_id: 'audit-1',
    body: 'Fridge log gap',
    isa_domain: null,
    is_positive: false,
    deleted_at: null,
    promoted_finding_id: null,
    promoted_entry_id: null,
    created_by: 'user-1',
    created_at: '2026-09-08T09:30:00Z',
    updated_at: '2026-09-08T09:30:00Z',
  };
}

function makeEntry(): MockWorkspaceEntry {
  return {
    id: 'entry-1',
    audit_id: 'audit-1',
    protocol_risk_id: null,
    vendor_service_mapping_id: null,
    questionnaire_response_id: null,
    checkpoint_ref: null,
    vendor_domain: 'Validation',
    observation_text: 'Observed X',
    provisional_impact: 'MINOR',
    provisional_classification: 'FINDING',
    inherited_endpoint_tier: null,
    inherited_impact_surface: null,
    inherited_time_sensitivity: null,
    risk_context_outdated: false,
    source_extracted_item_id: null,
    created_by_name: 'Auditor',
    created_at: '2026-08-01T00:00:00Z',
  };
}

describe('AuditConductWorkspace — one-ahead preview guard (PR-UX2) + fieldwork lane mounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveAudit = { ...BASE_AUDIT };
    mockEntries = { 'audit-1': [makeEntry()] };
    mockFetchVendorNotes.mockResolvedValue({ ok: true, data: [makeNote('note-1')] });
  });

  it('PREVIEW (audit at Stage 5): notice up, New-entry hidden, advance disabled despite entries; pad mounts read-only', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'PRE_AUDIT_DRAFTING' };

    render(<AuditConductWorkspace />);

    await waitFor(() => {
      expect(screen.getByText(/has not reached this stage yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /new entry/i })).not.toBeInTheDocument();
    // Entries exist, so pre-UX2 this was ENABLED and fired a +2 advance the
    // server rejects.
    expect(
      screen.getByRole('button', { name: /advance to report drafting/i }),
    ).toBeDisabled();
    // Per-entry edit affordance hidden too.
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    // The pad still mounts (notes are readable in preview) but is told the
    // stage is not reached, so its own mutation surfaces stay hidden.
    expect(screen.getByTestId('vendor-notes-pad').getAttribute('data-reached')).toBe('false');
  });

  it('AT STAGE: New-entry present, advance enabled with entries recorded; pad mounts live, above the record', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'AUDIT_CONDUCT' };

    render(<AuditConductWorkspace />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new entry/i })).toBeInTheDocument();
    });
    const advance = screen.getByRole('button', { name: /advance to report drafting/i });
    expect(advance).toBeEnabled();
    expect(screen.queryByText(/has not reached this stage yet/i)).not.toBeInTheDocument();
    const pad = screen.getByTestId('vendor-notes-pad');
    expect(pad.getAttribute('data-reached')).toBe('true');
    // Placement is a decision, not an accident: working papers sit above the
    // observation record and its stage transition; candidates sit between
    // the record and the transition.
    expect(pad.compareDocumentPosition(advance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const panel = screen.getByTestId('vendor-candidate-panel');
    expect(panel.getAttribute('data-reached')).toBe('true');
    expect(pad.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.compareDocumentPosition(advance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('reads the notes ONCE per audit and hands the same status + notes to the pad and the panel', async () => {
    render(<AuditConductWorkspace />);
    const pad = screen.getByTestId('vendor-notes-pad');
    const panel = screen.getByTestId('vendor-candidate-panel');
    expect(pad.getAttribute('data-status')).toBe('loading');
    expect(panel.getAttribute('data-notes-status')).toBe('loading');

    await waitFor(() => expect(pad.getAttribute('data-status')).toBe('ready'));
    expect(pad.getAttribute('data-notes')).toBe('1');
    expect(panel.getAttribute('data-notes-status')).toBe('ready');
    expect(panel.getAttribute('data-notes')).toBe('1');
    expect(mockFetchVendorNotes).toHaveBeenCalledTimes(1);
    expect(mockFetchVendorNotes).toHaveBeenCalledWith('audit-1');
  });

  it('a failed notes read is a state on both surfaces — never an empty list; Retry refetches', async () => {
    mockFetchVendorNotes.mockResolvedValueOnce({ ok: false, error: 'permission denied' });
    render(<AuditConductWorkspace />);
    const pad = screen.getByTestId('vendor-notes-pad');
    await waitFor(() => expect(pad.getAttribute('data-status')).toBe('failed'));
    expect(pad.getAttribute('data-notes')).toBe('0');
    expect(screen.getByTestId('vendor-candidate-panel').getAttribute('data-notes-status')).toBe('failed');

    // The retry path is the workspace's, not the pad's — pinned here.
    fireEvent.click(screen.getByRole('button', { name: /retry notes/i }));
    await waitFor(() => expect(pad.getAttribute('data-status')).toBe('ready'));
    expect(mockFetchVendorNotes).toHaveBeenCalledTimes(2);
    expect(pad.getAttribute('data-notes')).toBe('1');
  });

  it('switching audits never hands the previous audit\'s notes to the next one — the slot is keyed by audit', async () => {
    const { rerender } = render(<AuditConductWorkspace />);
    const pad = screen.getByTestId('vendor-notes-pad');
    await waitFor(() => expect(pad.getAttribute('data-status')).toBe('ready'));

    // Audit 2's read never resolves within this test: the pad must show
    // loading with no notes, not audit 1's ready read.
    mockFetchVendorNotes.mockImplementation(() => new Promise(() => {}));
    mockActiveAudit = { ...BASE_AUDIT, id: 'audit-2' };
    rerender(<AuditConductWorkspace />);

    const pad2 = screen.getByTestId('vendor-notes-pad');
    expect(pad2.getAttribute('data-status')).toBe('loading');
    expect(pad2.getAttribute('data-notes')).toBe('0');
    expect(screen.getByTestId('vendor-candidate-panel').getAttribute('data-notes-status')).toBe('loading');
    expect(mockFetchVendorNotes).toHaveBeenLastCalledWith('audit-2');
  });

  it('an accepted candidate is appended to the shared entry store — the same merge the entry form uses', async () => {
    render(<AuditConductWorkspace />);
    await waitFor(() => expect(screen.getByTestId('vendor-notes-pad').getAttribute('data-notes')).toBe('1'));
    // The hydrate effect's own set is not the assertion target.
    mockSetWorkspaceEntries.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /simulate accept/i }));

    expect(mockSetWorkspaceEntries).toHaveBeenCalledTimes(1);
    const updater = mockSetWorkspaceEntries.mock.calls[0][0] as (
      prev: Record<string, MockWorkspaceEntry[]>,
    ) => Record<string, MockWorkspaceEntry[]>;
    const next = updater({ 'audit-1': [makeEntry()] });
    expect(next['audit-1'].map((e) => e.id)).toEqual(['entry-1', 'entry-promoted']);
  });
});
