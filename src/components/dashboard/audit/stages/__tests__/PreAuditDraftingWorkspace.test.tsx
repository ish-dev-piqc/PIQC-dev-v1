// PR-UX2 — one-ahead preview guard for Stage 5. Previewing from Stage 4 used
// to fire the silent prefill bootstrap on mount, materialising all three
// deliverables for an audit that hadn't reached drafting. The preview must be
// a pure read; the bootstrap fires only once the stage is real. Mock idiom
// follows ReportDraftingWorkspace.test.tsx (PR #66/#69 precedent).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

// Real useState behind the store so the component's own setPreAuditBundles
// (after the mount fetch resolves) actually re-renders with the bundle —
// the tab UI is unreachable with a vi.fn() setter. Same pattern as
// FinalReviewExportWorkspace.test.tsx's stageReadouts mock.
let initialBundles: Record<string, unknown> = {};
vi.mock('../../../../../context/AuditDataContext', () => ({
  useAuditData: () => {
    const [preAuditBundles, setPreAuditBundles] = useState(initialBundles);
    return { preAuditBundles, setPreAuditBundles };
  },
}));

const EMPTY_BUNDLE = {
  confirmation_letter: null,
  agenda: null,
  checklist: null,
  internal_notification: null,
};
vi.mock('../../../../../lib/audit/preAuditApi', () => ({
  fetchPreAuditDeliverables: vi.fn(() => Promise.resolve(EMPTY_BUNDLE)),
  upsertConfirmationLetter: vi.fn(),
  approveConfirmationLetter: vi.fn(),
  upsertAgenda: vi.fn(),
  approveAgenda: vi.fn(),
  upsertChecklist: vi.fn(),
  approveChecklist: vi.fn(),
  upsertInternalNotification: vi.fn(),
  approveInternalNotification: vi.fn(),
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
    initialBundles = {};
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

  it('PREVIEW with an existing deliverable: Edit/Approve hidden, generation CTA disabled', async () => {
    // Legacy state: pre-UX2 the mount prefill fired during previews, so real
    // audits at Stage 4 carry Stage-5 rows. The tab UI renders — but every
    // write affordance must be off.
    mockActiveAudit = {
      id: 'audit-1',
      workflow_type: 'VENDOR_AUDIT',
      current_stage: 'SCOPE_AND_RISK_REVIEW',
    };
    mockFetch.mockResolvedValue({
      confirmation_letter: {
        id: 'cl-1',
        audit_id: 'audit-1',
        content: { body_text: 'Letter body.', recipients: [], scope: [] },
        approval_status: 'DRAFT',
        approved_at: null,
        approved_by_name: null,
        updated_at: '2026-08-01T00:00:00Z',
      },
      agenda: null,
      checklist: null,
      internal_notification: null,
    });

    render(<PreAuditDraftingWorkspace />);

    await waitFor(() => expect(screen.getByText('Letter body.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('confirmation_letter-generate-button')).toBeDisabled();
    expect(mockPrefill).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PR-D1 — internal notification: 4th tab exists but NEVER gates advance.
// ---------------------------------------------------------------------------

const approvedRow = (id: string, content: Record<string, unknown>) => ({
  id,
  audit_id: 'audit-1',
  content,
  approval_status: 'APPROVED',
  approved_at: '2026-09-01T00:00:00Z',
  approved_by_name: 'You',
  updated_at: '2026-09-01T00:00:00Z',
});

const TRIO_APPROVED_BUNDLE = {
  confirmation_letter: approvedRow('cl-1', { body_text: 'Letter body.', recipients: [], scope: [] }),
  agenda: approvedRow('ag-1', { items: [] }),
  checklist: approvedRow('ch-1', { items: [] }),
  internal_notification: null,
};

describe('PreAuditDraftingWorkspace — internal notification is non-gating (PR-D1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initialBundles = {};
    mockActiveAudit = {
      id: 'audit-1',
      workflow_type: 'VENDOR_AUDIT',
      current_stage: 'PRE_AUDIT_DRAFTING',
    };
  });

  it('advance unlocks with the trio approved while the notification is absent', async () => {
    mockFetch.mockResolvedValue(TRIO_APPROVED_BUNDLE);

    render(<PreAuditDraftingWorkspace />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /advance to audit conduct/i })).toBeEnabled(),
    );
    expect(screen.getByText(/gating deliverables approved/i)).toBeInTheDocument();
  });

  it('the gate list names only the three gating kinds', async () => {
    // Notification exists as DRAFT; letter still DRAFT → gate list renders.
    mockFetch.mockResolvedValue({
      ...TRIO_APPROVED_BUNDLE,
      confirmation_letter: {
        ...TRIO_APPROVED_BUNDLE.confirmation_letter,
        approval_status: 'DRAFT',
        approved_at: null,
        approved_by_name: null,
      },
      internal_notification: approvedRow('in-1', { body_text: 'Heads-up.', scope: [] }),
    });

    render(<PreAuditDraftingWorkspace />);

    await waitFor(() =>
      expect(
        screen.getByText(/approve the confirmation letter, agenda, and checklist to advance/i),
      ).toBeInTheDocument(),
    );
    // 'Internal notification' appears exactly once — the tab button. The
    // transition gate list must not add a second occurrence.
    expect(screen.getAllByText('Internal notification')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /advance to audit conduct/i })).toBeDisabled();
  });

  it('the 4th tab opens to its scratch form at stage (no prefill for this kind)', async () => {
    mockFetch.mockResolvedValue({ ...TRIO_APPROVED_BUNDLE });

    render(<PreAuditDraftingWorkspace />);

    await waitFor(() => expect(screen.getByText('Internal notification')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /internal notification/i }));

    expect(screen.getByTestId('internal_notification-generate-button')).toBeEnabled();
    expect(
      screen.getByPlaceholderText(/announce the audit to internal stakeholders/i),
    ).toBeInTheDocument();
  });
});
