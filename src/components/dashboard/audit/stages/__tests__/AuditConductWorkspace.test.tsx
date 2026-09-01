// PR-UX2 — one-ahead preview guard for Stage 6. Previewing from Stage 5 used
// to leave "New entry" and the advance button live — the advance fired a +2
// jump the server rejects (dead click), and observations could be recorded
// for conduct that hadn't happened. Mock idiom follows
// ReportDraftingWorkspace.test.tsx; the SOTR drawers are stubbed shallow so
// the test doesn't pull the SOTR tree.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { MockWorkspaceEntry } from '../../../../../lib/audit/mockWorkspaceEntries';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

let mockActiveAudit = {
  id: 'audit-1',
  protocol_id: 'proto-1',
  protocol_code: 'PIQC-001',
  workflow_type: 'VENDOR_AUDIT',
  current_stage: 'AUDIT_CONDUCT',
};
const mockAdvanceStage = vi.fn();
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
  }),
}));

let mockEntries: Record<string, MockWorkspaceEntry[]> = {};
vi.mock('../../../../../context/AuditDataContext', () => ({
  useAuditData: () => ({
    workspaceEntries: mockEntries,
    setWorkspaceEntries: vi.fn(),
    protocolRisks: {},
  }),
}));

vi.mock('../../../../../lib/audit/workspaceEntriesApi', () => ({
  fetchWorkspaceEntries: vi.fn(() => Promise.resolve([])),
  createWorkspaceEntry: vi.fn(),
  updateWorkspaceEntry: vi.fn(),
}));

// SOTR drawers are cross-surface heavies; the preview test only needs them
// to mount as nothing.
vi.mock('../../../../sotr/SourceTruthListDrawer', () => ({ default: () => null }));
vi.mock('../../../../sotr/SourceTruthDrawer', () => ({ default: () => null }));
vi.mock('../../../../sotr/WorksheetItemRow', () => ({
  formatExtractedValue: () => '',
}));

// The notes pad has its own suite (vendor/__tests__/VendorNotesPad.test.tsx);
// here it mounts as a marker that echoes the preview flag it was handed.
vi.mock('../vendor/VendorNotesPad', () => ({
  default: ({ hasReached }: { hasReached: boolean }) => (
    <div data-testid="vendor-notes-pad" data-reached={String(hasReached)} />
  ),
}));

import AuditConductWorkspace from '../AuditConductWorkspace';

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

describe('AuditConductWorkspace — one-ahead preview guard (PR-UX2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEntries = { 'audit-1': [makeEntry()] };
  });

  it('PREVIEW (audit at Stage 5): notice up, New-entry hidden, advance disabled despite entries', async () => {
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
  });

  it('AT STAGE: New-entry present, advance enabled with entries recorded', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'AUDIT_CONDUCT' };

    render(<AuditConductWorkspace />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new entry/i })).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /advance to report drafting/i }),
    ).toBeEnabled();
    expect(screen.queryByText(/has not reached this stage yet/i)).not.toBeInTheDocument();
  });
});

describe('AuditConductWorkspace — fieldwork notes pad (vendor lane, slice 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEntries = { 'audit-1': [makeEntry()] };
  });

  it('mounts the pad above the observation form and threads the preview flag through', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'AUDIT_CONDUCT' };
    render(<AuditConductWorkspace />);
    const pad = await screen.findByTestId('vendor-notes-pad');
    expect(pad.getAttribute('data-reached')).toBe('true');
  });

  it('PREVIEW: the pad still mounts (notes are readable) but is told the stage is not reached', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'PRE_AUDIT_DRAFTING' };
    render(<AuditConductWorkspace />);
    const pad = await screen.findByTestId('vendor-notes-pad');
    expect(pad.getAttribute('data-reached')).toBe('false');
  });
});
