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

// Local yyyy-mm-dd relative to today — mirrors the component's todayLocalIso
// so these tests are date-independent.
function isoDaysFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('en-CA');
}

function makeAudit(overrides: Partial<AuditWithContext>): AuditWithContext {
  return {
    id: 'audit-1',
    audit_name: 'Windowed audit',
    audit_type: 'REMOTE',
    workflow_type: 'VENDOR_AUDIT',
    status: 'IN_PROGRESS',
    current_stage: 'AUDIT_CONDUCT',
    scheduled_date: null,
    scheduled_end_date: null,
    vendor_name: 'Acme CRO',
    auditee_name: 'Acme CRO',
    site_number: null,
    principal_investigator: null,
    site_country: null,
    protocol_code: 'STU-1',
    protocol_title: 'A study',
    clinical_trial_phase: 'NOT_APPLICABLE',
    protocol_id: 'protocol-1',
    protocol_version_id: 'pv-1',
    ...overrides,
  };
}

describe('AuditRequiredGate — overdue respects the scheduled window (PR-UX1)', () => {
  it('an in-window multi-day audit is NOT overdue', () => {
    // Started yesterday, ends tomorrow — on schedule until the END date.
    mockAudits = [
      makeAudit({
        scheduled_date: isoDaysFromToday(-1),
        scheduled_end_date: isoDaysFromToday(1),
      }),
    ];
    render(<AuditRequiredGate />);
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });

  it('an audit whose window has fully passed is overdue', () => {
    mockAudits = [
      makeAudit({
        scheduled_date: isoDaysFromToday(-3),
        scheduled_end_date: isoDaysFromToday(-1),
      }),
    ];
    render(<AuditRequiredGate />);
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
  });

  it('a past single-date audit (no end date) is still overdue', () => {
    mockAudits = [makeAudit({ scheduled_date: isoDaysFromToday(-1) })];
    render(<AuditRequiredGate />);
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
  });
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
