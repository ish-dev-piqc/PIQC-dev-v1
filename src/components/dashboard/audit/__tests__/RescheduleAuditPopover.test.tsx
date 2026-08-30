// Unit tests for RescheduleAuditPopover — the workspace header's date line
// (PR-UX1). Mocks the auditApi wrapper at the import boundary (the RPC's
// validation and delta-writing live server-side and are exercised there);
// these tests pin the client contract: what the trigger shows, what Save
// sends, and how a rejection surfaces.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuditWithContext } from '../../../../context/AuditContext';

vi.mock('../../../../lib/audit/auditApi', () => ({
  rescheduleAudit: vi.fn(),
}));

import RescheduleAuditPopover from '../RescheduleAuditPopover';
import { rescheduleAudit } from '../../../../lib/audit/auditApi';

const mockReschedule = rescheduleAudit as ReturnType<typeof vi.fn>;

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RescheduleAuditPopover', () => {
  it('trigger shows the window, or "Not scheduled" as the set-dates affordance', () => {
    const { rerender } = render(
      <RescheduleAuditPopover
        audit={makeAudit({ scheduled_date: '2026-09-15', scheduled_end_date: '2026-09-17' })}
        isLight
        onRescheduled={vi.fn()}
      />,
    );
    expect(screen.getByTestId('audit-reschedule-trigger')).toHaveTextContent('Sep 15 – 17, 2026');

    rerender(<RescheduleAuditPopover audit={makeAudit({})} isLight onRescheduled={vi.fn()} />);
    expect(screen.getByTestId('audit-reschedule-trigger')).toHaveTextContent('Not scheduled · set dates');
  });

  it('seeds from the audit, sends the edited window + reason, and closes on success', async () => {
    mockReschedule.mockResolvedValueOnce({
      ok: true,
      scheduledDate: '2026-09-15',
      scheduledEndDate: '2026-09-17',
    });
    const onRescheduled = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <RescheduleAuditPopover
        audit={makeAudit({ scheduled_date: '2026-09-15' })}
        isLight
        onRescheduled={onRescheduled}
      />,
    );

    await user.click(screen.getByTestId('audit-reschedule-trigger'));
    const start = screen.getByLabelText('Start date') as HTMLInputElement;
    expect(start.value).toBe('2026-09-15');

    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-17' } });
    await user.type(screen.getByLabelText('Reason'), 'vendor requested');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(mockReschedule).toHaveBeenCalledWith('audit-1', '2026-09-15', '2026-09-17', 'vendor requested'),
    );
    expect(onRescheduled).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('surfaces the RPC rejection inline and stays open', async () => {
    mockReschedule.mockResolvedValueOnce({
      ok: false,
      errorMessage: 'End date must be on or after the start date',
    });
    const onRescheduled = vi.fn();
    const user = userEvent.setup();
    render(
      <RescheduleAuditPopover
        audit={makeAudit({ scheduled_date: '2026-09-15' })}
        isLight
        onRescheduled={onRescheduled}
      />,
    );

    await user.click(screen.getByTestId('audit-reschedule-trigger'));
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/End date must be on or after/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onRescheduled).not.toHaveBeenCalled();
  });

  it('Clear dates empties both inputs; Save then records the cleared window', async () => {
    mockReschedule.mockResolvedValueOnce({ ok: true, scheduledDate: null, scheduledEndDate: null });
    const user = userEvent.setup();
    render(
      <RescheduleAuditPopover
        audit={makeAudit({ scheduled_date: '2026-09-15', scheduled_end_date: '2026-09-17' })}
        isLight
        onRescheduled={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('audit-reschedule-trigger'));
    await user.click(screen.getByRole('button', { name: /clear dates/i }));

    const start = screen.getByLabelText('Start date') as HTMLInputElement;
    const end = screen.getByLabelText('End date') as HTMLInputElement;
    expect(start.value).toBe('');
    expect(end.value).toBe('');
    // End-without-start is rejected by the RPC; the UI never offers it.
    expect(end).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(mockReschedule).toHaveBeenCalledWith('audit-1', null, null, undefined),
    );
  });
});
