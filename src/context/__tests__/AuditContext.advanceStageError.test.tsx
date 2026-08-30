import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuditProvider, useAudit } from '../AuditContext';
import type { AdvanceAuditStageResult } from '../../lib/audit/auditApi';
import type { AuditStage } from '../../types/audit';

// =============================================================================
// Regression (CTX-M2 / CTX-201): AuditContext.advanceStage used to swallow a
// failed advanceAuditStage() with only a console.error. Its return type is
// void and the context exposed no error field, so a server-side gate rejection
// (GATE_QUESTIONNAIRE_NOT_APPROVED etc.) produced NO user-facing signal — the
// click was silently lost (AUD-301 class).
//
// The fix adds `advanceStageError: string | null` to AuditContextValue, set
// from result.errorMessage(+errorHint) on failure and cleared on the next
// attempt / success. These tests lock that contract through the real provider.
// =============================================================================

const AUDIT_ID = 'audit-1';

// One audit row shaped like the joined Supabase select in fetchAudits(). Only
// the fields flatten() reads matter; the rest are filled minimally.
const AUDIT_ROW = {
  id: AUDIT_ID,
  audit_name: 'Test audit',
  audit_type: 'ROUTINE',
  workflow_type: 'VENDOR_AUDIT',
  status: 'IN_PROGRESS',
  current_stage: 'SCOPE_AND_RISK_REVIEW' as AuditStage,
  scheduled_date: null,
  scheduled_end_date: null,
  protocol_id: 'protocol-1',
  protocol_version_id: 'protocol-version-1',
  vendors: { name: 'Acme CRO' },
  sites: null,
  protocols: { study_number: 'STU-1', title: 'A study' },
  protocol_versions: { clinical_trial_phase: 'PHASE_2' },
};

// Chainable stub for `supabase.from('audits').select(...).order(...)` plus the
// auth subscription the provider sets up on mount.
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [AUDIT_ROW], error: null }),
      }),
    }),
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  },
}));

// The RPC wrapper — each test sets the next result it should return.
let nextResult: AdvanceAuditStageResult = { ok: false };
const advanceAuditStageMock = vi.fn(
  async (): Promise<AdvanceAuditStageResult> => nextResult,
);
vi.mock('../../lib/audit/auditApi', () => ({
  // The mock ignores args (each test seeds nextResult); the wrapper just needs
  // to resolve the seeded Result so advanceStage's error-surfacing path runs.
  advanceAuditStage: () => advanceAuditStageMock(),
}));

// Minimal consumer: a button that fires advanceStage, and a live readout of
// advanceStageError so we can assert what the context surfaces to workspaces.
function Consumer() {
  const { advanceStage, advanceStageError, activeAudit } = useAudit();
  return (
    <div>
      <span data-testid="active">{activeAudit?.id ?? 'none'}</span>
      <button type="button" onClick={() => advanceStage('PRE_AUDIT_DRAFTING')}>
        advance
      </button>
      <span data-testid="err">{advanceStageError ?? ''}</span>
    </div>
  );
}

async function renderWithActiveAudit() {
  render(
    <AuditProvider>
      <Consumer />
    </AuditProvider>,
  );
  // Wait for the initial fetch to hydrate audits so activeAudit resolves from
  // the persisted id.
  await waitFor(() => expect(screen.getByTestId('active').textContent).toBe(AUDIT_ID));
}

describe('AuditContext.advanceStage error surfacing', () => {
  beforeEach(() => {
    advanceAuditStageMock.mockClear();
    localStorage.setItem('piq-audit-v1', AUDIT_ID);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('sets advanceStageError from errorMessage + errorHint when the RPC rejects', async () => {
    nextResult = {
      ok: false,
      errorMessage: 'Questionnaire not approved',
      errorHint: 'GATE_QUESTIONNAIRE_NOT_APPROVED',
    };
    await renderWithActiveAudit();

    expect(screen.getByTestId('err').textContent).toBe('');
    await act(async () => {
      screen.getByRole('button', { name: 'advance' }).click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('err').textContent).toBe(
        'Questionnaire not approved (GATE_QUESTIONNAIRE_NOT_APPROVED)',
      ),
    );
  });

  it('falls back to a generic message when the failure carries no errorMessage', async () => {
    nextResult = { ok: false };
    await renderWithActiveAudit();

    await act(async () => {
      screen.getByRole('button', { name: 'advance' }).click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('err').textContent).toBe('Stage advancement failed.'),
    );
  });

  it('clears advanceStageError on a subsequent successful advance', async () => {
    nextResult = { ok: false, errorMessage: 'Blocked' };
    await renderWithActiveAudit();

    await act(async () => {
      screen.getByRole('button', { name: 'advance' }).click();
    });
    await waitFor(() => expect(screen.getByTestId('err').textContent).toBe('Blocked'));

    // Next attempt succeeds — the stale error must clear.
    nextResult = { ok: true, currentStage: 'PRE_AUDIT_DRAFTING' };
    await act(async () => {
      screen.getByRole('button', { name: 'advance' }).click();
    });
    await waitFor(() => expect(screen.getByTestId('err').textContent).toBe(''));
  });
});
