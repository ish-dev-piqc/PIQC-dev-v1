// SiteIntakeWorkspace — ISA Stage 1. The read-only profile rows sourced from
// the audit, the parse-status card (mocked: it polls), and the ungated Site
// intake → Risk assessment transition (isa-stage-advance — the ISA pipeline
// had no advance control before). Card states are pinned in
// StageTransitionCard.test.tsx; here we lock the wrapper: header, rows, the
// card mounted with the right target, and the already-advanced state.
// Mock idiom: IntakeWorkspace.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const mockAdvanceStage = vi.fn();
let mockActiveAudit = isaAuditAt('ISA_SITE_INTAKE');
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
  }),
}));

// A string child, not JSX: the factory is hoisted above the jsx runtime
// import. The card reaches src/lib/supabase through its Api module.
vi.mock('../ProtocolReadinessCard', () => ({
  default: () => 'readiness-card-marker',
}));

import SiteIntakeWorkspace from '../investigator/SiteIntakeWorkspace';

function isaAuditAt(stage: string) {
  return {
    id: 'audit-isa-1',
    workflow_type: 'INVESTIGATOR_SITE_AUDIT',
    current_stage: stage,
    auditee_name: 'Site 042',
    site_number: '042',
    principal_investigator: 'Dr A. Investigator',
    site_country: 'Canada',
    protocol_code: 'PROTO-001',
    protocol_title: 'Protocol one',
    clinical_trial_phase: 'PHASE_3',
    audit_type: 'ONSITE',
  };
}

describe('SiteIntakeWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveAudit = isaAuditAt('ISA_SITE_INTAKE');
  });

  it('renders the Stage-1 header, the site and protocol rows, the parse-status card, and the transition to Risk assessment', () => {
    render(<SiteIntakeWorkspace />);

    expect(screen.getByText('Stage 1 · Site intake')).toBeInTheDocument();
    expect(screen.getByText('Confirm the site under audit')).toBeInTheDocument();
    expect(screen.getByText('Site 042')).toBeInTheDocument();
    expect(screen.getByText('042')).toBeInTheDocument();
    expect(screen.getByText('Dr A. Investigator')).toBeInTheDocument();
    expect(screen.getByText('Canada')).toBeInTheDocument();
    expect(screen.getByText('PROTO-001')).toBeInTheDocument();
    expect(screen.getByText('Protocol one')).toBeInTheDocument();
    expect(screen.getByText('Phase 3')).toBeInTheDocument();
    expect(screen.getByText('Onsite')).toBeInTheDocument();
    expect(screen.getByText('readiness-card-marker')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /advance to risk assessment/i });
    expect(button).toBeEnabled();
    expect(screen.getByText('Ready to advance')).toBeInTheDocument();
    fireEvent.click(button);
    expect(mockAdvanceStage).toHaveBeenCalledTimes(1);
    expect(mockAdvanceStage).toHaveBeenCalledWith('ISA_RISK_ASSESSMENT');
  });

  it('once the audit has moved on, the transition reads already-advanced and is disabled', () => {
    mockActiveAudit = isaAuditAt('ISA_RISK_ASSESSMENT');

    render(<SiteIntakeWorkspace />);

    expect(screen.getByText('Audit has already advanced past this stage')).toBeInTheDocument();
    expect(screen.getByText('Current stage: Risk assessment')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /advance to risk assessment/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockAdvanceStage).not.toHaveBeenCalled();
  });

  it('falls back to a placeholder when the site has no number, and drops the protocol row without a code', () => {
    mockActiveAudit = { ...isaAuditAt('ISA_SITE_INTAKE'), site_number: '', protocol_code: '' };

    render(<SiteIntakeWorkspace />);

    // Only the site number is blank, so exactly one placeholder dash renders.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('PROTO-001')).not.toBeInTheDocument();
    expect(screen.queryByText('Protocol', { selector: 'dt' })).not.toBeInTheDocument();
    expect(screen.getByText('Protocol one')).toBeInTheDocument();
  });
});
