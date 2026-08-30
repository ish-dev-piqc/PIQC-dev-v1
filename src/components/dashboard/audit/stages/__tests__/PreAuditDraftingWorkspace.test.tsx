// PR-UX2 — one-ahead preview guard for Stage 5. Previewing from Stage 4 used
// to fire the silent prefill bootstrap on mount, materialising all three
// deliverables for an audit that hadn't reached drafting. The preview must be
// a pure read; the bootstrap fires only once the stage is real. Mock idiom
// follows ReportDraftingWorkspace.test.tsx (PR #66/#69 precedent).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

let mockActiveAudit = {
  id: 'audit-1',
  workflow_type: 'VENDOR_AUDIT',
  current_stage: 'PRE_AUDIT_DRAFTING',
};
const mockAdvanceStage = vi.fn();
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
  }),
}));

vi.mock('../../../../../context/AuditDataContext', () => ({
  useAuditData: () => ({
    preAuditBundles: {},
    setPreAuditBundles: vi.fn(),
  }),
}));

const EMPTY_BUNDLE = { confirmation_letter: null, agenda: null, checklist: null };
vi.mock('../../../../../lib/audit/preAuditApi', () => ({
  fetchPreAuditDeliverables: vi.fn(() => Promise.resolve(EMPTY_BUNDLE)),
  upsertConfirmationLetter: vi.fn(),
  approveConfirmationLetter: vi.fn(),
  upsertAgenda: vi.fn(),
  approveAgenda: vi.fn(),
  upsertChecklist: vi.fn(),
  approveChecklist: vi.fn(),
  prefillStage5Deliverables: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../../../../../lib/audit/evidenceApi', () => ({
  listAuditEvidence: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
}));

vi.mock('../../../../../lib/audit/deliverableGenerationApi', () => ({
  applyDeliverableGeneration: vi.fn(),
  computeDeliverableCurrency: vi.fn(() => null),
  requestDeliverableDraft: vi.fn(),
}));

import PreAuditDraftingWorkspace from '../PreAuditDraftingWorkspace';
import {
  fetchPreAuditDeliverables,
  prefillStage5Deliverables,
} from '../../../../../lib/audit/preAuditApi';

const mockFetch = fetchPreAuditDeliverables as ReturnType<typeof vi.fn>;
const mockPrefill = prefillStage5Deliverables as ReturnType<typeof vi.fn>;

describe('PreAuditDraftingWorkspace — one-ahead preview guard (PR-UX2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(EMPTY_BUNDLE);
  });

  it('PREVIEW (audit at Stage 4): prefill does NOT fire, notice up, stub button absent', async () => {
    mockActiveAudit = {
      id: 'audit-1',
      workflow_type: 'VENDOR_AUDIT',
      current_stage: 'SCOPE_AND_RISK_REVIEW',
    };

    render(<PreAuditDraftingWorkspace />);

    // The load effect still reads (previews render real data)…
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('audit-1'));
    // …but the bootstrap write stays off.
    expect(mockPrefill).not.toHaveBeenCalled();
    expect(screen.getByText(/has not reached this stage yet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /generate all three stubs/i }),
    ).not.toBeInTheDocument();
  });

  it('AT STAGE, all three missing: prefill bootstrap fires once', async () => {
    mockActiveAudit = {
      id: 'audit-1',
      workflow_type: 'VENDOR_AUDIT',
      current_stage: 'PRE_AUDIT_DRAFTING',
    };

    render(<PreAuditDraftingWorkspace />);

    await waitFor(() => expect(mockPrefill).toHaveBeenCalledWith('audit-1'));
    expect(mockPrefill).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/has not reached this stage yet/i)).not.toBeInTheDocument();
  });
});
