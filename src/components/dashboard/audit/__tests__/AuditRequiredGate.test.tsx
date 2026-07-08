// Unit tests for AuditRequiredGate — the Audit Workspace hub, shown when no
// audit is selected.
//
// Focus: the load-error state. When the audits SELECT errors, AuditContext sets
// audits to [] and surfaces `error`. The gate must render an error card with a
// Retry — NOT the "No audits yet" empty state, which would tell a QA auditor
// their audits vanished when the DB merely hiccupped.
//
// Mock surface (extends the ReportDraftingWorkspace precedent — mock the context
// hooks rather than wrapping real providers):
//   - ThemeContext + AuditContext — the two hooks the gate consumes.
//   - NewAuditDrawer — heavy child that pulls the creation API → supabase. The
//     gate only mounts it behind the "Start a new audit" button, which these
//     tests never click, so a null stub keeps that import chain out of the test.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuditWithContext } from '../../../../context/AuditContext';
import AuditRequiredGate from '../AuditRequiredGate';

vi.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const mockRefresh = vi.fn();
const mockSetActiveAudit = vi.fn();
let mockAudits: AuditWithContext[] = [];
let mockLoading = false;
let mockError: string | null = null;
vi.mock('../../../../context/AuditContext', () => ({
  useAudit: () => ({
    audits: mockAudits,
    loading: mockLoading,
    error: mockError,
    refresh: mockRefresh,
    setActiveAudit: mockSetActiveAudit,
  }),
}));

vi.mock('../onboarding/NewAuditDrawer', () => ({
  default: () => null,
}));

beforeEach(() => {
  mockRefresh.mockReset();
  mockSetActiveAudit.mockReset();
  mockAudits = [];
  mockLoading = false;
  mockError = null;
});

describe('AuditRequiredGate — load error state', () => {
  it('renders the error message + a Retry control, and NOT the empty state', () => {
    mockError = 'boom';
    mockAudits = [];
    mockLoading = false;
    render(<AuditRequiredGate />);

    // Teach-forward heading + the raw error, so the auditor reads this as a
    // transient load failure, not a vanished worklist.
    expect(screen.getByText(/Couldn't load your audits/i)).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    // The empty state must NOT win — a failed load is not "no audits".
    expect(screen.queryByText(/No audits yet/i)).not.toBeInTheDocument();
  });

  it('calls refresh when Retry is clicked', async () => {
    mockError = 'boom';
    const user = userEvent.setup();
    render(<AuditRequiredGate />);

    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
