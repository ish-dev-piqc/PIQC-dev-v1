// Unit tests for Navbar's Audit Mode picker — the top-bar "All audits" exit.
//
// Focus: the home scope. With no active audit the trigger must read "All
// audits" (the hub IS the scope, not "nothing selected"), the listbox must
// lead with an "All audits" option marked selected, and choosing that option
// from inside an audit must clear the active audit and close the menu. This
// is the picker half of the audit-level exit; the workspace shell's back link
// is the other half (the shell has no test file by house convention — see the
// plan MD's manual walk).
//
// Mock surface (AuditRequiredGate.test.tsx precedent — mock the context hooks
// rather than wrapping real providers): every context hook Navbar consumes,
// plus null stubs for the four child components whose import chains reach
// supabase (MembersDrawer, OrgSwitcher, RequestAccessButton,
// ProtocolUploadModal). Navbar only mounts them behind interactions these
// tests never perform.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuditWithContext } from '../../context/AuditContext';
import Navbar from '../Navbar';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    signOut: vi.fn(),
    user: { email: 'auditor@example.com' },
    session: { access_token: 'token' },
  }),
}));
vi.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));
vi.mock('../../context/ModeContext', () => ({
  useMode: () => ({ mode: 'audit' as const }),
}));
vi.mock('../../context/ProtocolContext', () => ({
  useProtocol: () => ({
    protocols: [],
    isLoading: false,
    activeProtocol: null,
    setActiveProtocol: vi.fn(),
  }),
}));
vi.mock('../../context/OrgContext', () => ({
  useOrg: () => ({ myProtocolIds: [], myOrgs: [] }),
}));
vi.mock('../../context/HeatmapContext', () => ({
  useHeatmap: () => ({ enabled: false, toggle: vi.fn() }),
}));
vi.mock('../../context/DemoModeContext', () => ({
  useDemoMode: () => ({ demoActive: false, setDemoActive: vi.fn(), canUseDemo: false }),
}));
vi.mock('../../context/UnreadMentionsContext', () => ({
  useUnreadMentionsDisplay: () => ({ count: 0, display: '' }),
}));

const mockSetActiveAudit = vi.fn();
let mockAudits: AuditWithContext[] = [];
let mockActiveAudit: AuditWithContext | null = null;
vi.mock('../../context/AuditContext', () => ({
  useAudit: () => ({
    audits: mockAudits,
    activeAudit: mockActiveAudit,
    setActiveAudit: mockSetActiveAudit,
  }),
}));

vi.mock('../dashboard/orgs/MembersDrawer', () => ({ default: () => null }));
vi.mock('../dashboard/orgs/OrgSwitcher', () => ({ default: () => null }));
vi.mock('../dashboard/orgs/RequestAccessButton', () => ({ default: () => null }));
vi.mock('../dashboard/site/ProtocolUploadModal', () => ({ default: () => null }));

beforeEach(() => {
  mockSetActiveAudit.mockReset();
  mockAudits = [];
  mockActiveAudit = null;
});

function makeAudit(overrides: Partial<AuditWithContext>): AuditWithContext {
  return {
    id: 'audit-1',
    audit_name: 'Q3 central lab audit',
    audit_type: 'REMOTE',
    workflow_type: 'VENDOR_AUDIT',
    status: 'IN_PROGRESS',
    current_stage: 'INTAKE',
    scheduled_date: null,
    scheduled_end_date: null,
    vendor_name: 'Vendor A',
    auditee_name: 'Vendor A',
    site_number: null,
    principal_investigator: null,
    site_country: null,
    protocol_code: 'PROTO-001',
    protocol_title: 'Protocol one',
    clinical_trial_phase: 'PHASE_2',
    protocol_id: 'protocol-1',
    protocol_version_id: 'version-1',
    ...overrides,
  };
}

const navbarProps = {
  view: 'dashboard' as const,
  onViewChange: vi.fn(),
  onDashboardHome: vi.fn(),
  onOpenSettingsSection: vi.fn(),
  onOpenOrganization: vi.fn(),
};

describe('Navbar audit picker — home scope', () => {
  it('reads "All audits" with no active audit and leads the list with the selected home option', async () => {
    const user = userEvent.setup();
    mockAudits = [makeAudit({ id: 'audit-1', audit_name: 'Q3 central lab audit' })];
    render(<Navbar {...navbarProps} />);

    const trigger = screen.getByRole('button', { name: 'All audits' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options[0]).toHaveTextContent('All audits');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    // The library follows under its own header; nothing else is selected.
    expect(within(listbox).getByText('Your audits')).toBeInTheDocument();
    expect(options[1]).toHaveTextContent('Q3 central lab audit');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('clears the active audit and closes the menu when "All audits" is chosen from inside an audit', async () => {
    const user = userEvent.setup();
    const audit = makeAudit({ id: 'audit-1', audit_name: 'Q3 central lab audit' });
    mockAudits = [audit];
    mockActiveAudit = audit;
    render(<Navbar {...navbarProps} />);

    await user.click(screen.getByRole('button', { name: 'Q3 central lab audit' }));

    const home = screen.getByRole('option', { name: /^All audits/ });
    expect(home).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('option', { name: /Q3 central lab audit/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(home);

    expect(mockSetActiveAudit).toHaveBeenCalledTimes(1);
    expect(mockSetActiveAudit).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps the home option and the empty-library copy when the auditor has no audits', async () => {
    const user = userEvent.setup();
    render(<Navbar {...navbarProps} />);

    await user.click(screen.getByRole('button', { name: 'All audits' }));

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /^All audits/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(listbox).getByText('No audits yet.')).toBeInTheDocument();
  });
});
