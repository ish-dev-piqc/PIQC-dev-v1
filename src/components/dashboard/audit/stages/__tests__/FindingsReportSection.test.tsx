// FindingsReportSection (PR-D4) — the findings report's Stage-7 surface.
// Pins the honesty contracts the section owns:
//   - load failure renders the retry banner, never a scratch form
//     (absence ≠ failure)
//   - the observation blocks derive from live entries, exclude
//     NOT_YET_CLASSIFIED, and carry the code-owned QA-placeholder line
//   - Approve is blocked while the live entry digest is unknown, and passes
//     BOTH pins when it fires
//   - STALE_BASIS routes through the workbench reload flow with basis copy
//   - a failed save banners and keeps the editor open (PR-1 posture)
//   - post-approval divergence (sealed ≠ live digest) banners
//   - preview from ahead locks generate + edit
// Mock idiom follows PreAuditDraftingWorkspace.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../lib/audit/findingsReport', () => ({
  fetchFindingsReport: vi.fn(),
  fetchEntrySetDigest: vi.fn(),
  upsertFindingsReport: vi.fn(),
  approveFindingsReport: vi.fn(),
}));

vi.mock('../../../../../lib/audit/evidenceApi', () => ({
  listAuditEvidence: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
}));

vi.mock('../../../../../lib/audit/workspaceEntriesApi', () => ({
  fetchWorkspaceEntries: vi.fn(),
}));

vi.mock('../../../../../lib/audit/deliverableGenerationApi', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../../../lib/audit/deliverableGenerationApi')
  >()),
  applyDeliverableGeneration: vi.fn(),
  computeDeliverableCurrency: vi.fn(() => null),
  requestDeliverableDraft: vi.fn(),
}));

import FindingsReportSection from '../FindingsReportSection';
import {
  approveFindingsReport,
  fetchEntrySetDigest,
  fetchFindingsReport,
  upsertFindingsReport,
} from '../../../../../lib/audit/findingsReport';
import { fetchWorkspaceEntries } from '../../../../../lib/audit/workspaceEntriesApi';
import type { FindingsReport } from '../../../../../lib/audit/findingsReport';
import type { MockWorkspaceEntry } from '../../../../../lib/audit/mockWorkspaceEntries';
import type {
  ProvisionalClassification,
  ProvisionalImpact,
} from '../../../../../types/audit';

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function entry(
  id: string,
  classification: ProvisionalClassification,
  overrides: Partial<MockWorkspaceEntry> = {},
): MockWorkspaceEntry {
  return {
    id,
    audit_id: 'audit-1',
    protocol_risk_id: null,
    vendor_service_mapping_id: null,
    questionnaire_response_id: null,
    checkpoint_ref: null,
    vendor_domain: 'Validation',
    observation_text: `Observation body for ${id}`,
    provisional_impact: 'MINOR' as ProvisionalImpact,
    provisional_classification: classification,
    inherited_endpoint_tier: null,
    inherited_impact_surface: null,
    inherited_time_sensitivity: null,
    risk_context_outdated: false,
    source_extracted_item_id: null,
    created_by_name: 'Auditor One',
    created_at: '2026-08-01T09:00:00Z',
    ...overrides,
  };
}

const REPORT: FindingsReport = {
  id: 'fr1',
  audit_id: 'audit-1',
  content: { intro_text: 'Audit purpose narrative.', closing_text: 'Next steps narrative.' },
  approval_status: 'DRAFT',
  approved_at: null,
  approved_by_name: null,
  updated_at: '2026-09-06T10:00:00+00:00',
  basis_digest: null,
  generation_refs: null,
  grounding_snapshot: null,
  generated_at: null,
};

function renderSection(overrides: Partial<{ hasReached: boolean }> = {}) {
  return render(
    <FindingsReportSection
      auditId="audit-1"
      hasReached={overrides.hasReached ?? true}
      isLight
    />,
  );
}

// md5('') — the server's digest for a zero-entry audit. Mirrors the
// component's constant so the consistency pins below say what they mean.
const EMPTY_SET_DIGEST = 'd41d8cd98f00b204e9800998ecf8427e';

beforeEach(() => {
  vi.clearAllMocks();
  m(fetchFindingsReport).mockResolvedValue({ report: REPORT, failed: false });
  m(fetchEntrySetDigest).mockResolvedValue('digest-live');
  // The section fetches its own entries — the blocks' and the pin's data
  // come from the same read moment, never from the Stage-6 context cache.
  m(fetchWorkspaceEntries).mockResolvedValue([
    entry('e1', 'FINDING'),
    entry('e2', 'NOT_YET_CLASSIFIED'),
  ]);
});

describe('load + blocks', () => {
  it('renders the narrative and the blocks from live entries, with the QA placeholder', async () => {
    renderSection();
    expect(await screen.findByText('Audit purpose narrative.')).toBeTruthy();
    expect(screen.getByText('Next steps narrative.')).toBeTruthy();
    expect(screen.getByTestId('findings-report-block-e1')).toBeTruthy();
    // Code-owned template line — classifications are provisional pending QA.
    expect(
      screen.getAllByText('Final classification: [Classification: to be determined by QA]'),
    ).toHaveLength(1);
  });

  it('excludes NOT_YET_CLASSIFIED from the blocks and says so out loud', async () => {
    renderSection();
    await screen.findByTestId('findings-report-block-e1');
    expect(screen.queryByTestId('findings-report-block-e2')).toBeNull();
    expect(screen.getByText(/1 unclassified entry is excluded/)).toBeTruthy();
  });

  it('a failed row read renders the retry banner, never a scratch form, and Retry refetches', async () => {
    m(fetchFindingsReport).mockResolvedValue({ report: null, failed: true });
    renderSection();
    expect(await screen.findByTestId('findings-report-load-error')).toBeTruthy();
    expect(screen.queryByTestId('findings-report-edit-button')).toBeNull();
    m(fetchFindingsReport).mockResolvedValue({ report: REPORT, failed: false });
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByText('Audit purpose narrative.')).toBeTruthy();
  });
});

describe('approve — the dual pin', () => {
  it('is blocked while the live entry digest is unknown', async () => {
    m(fetchEntrySetDigest).mockResolvedValue(null);
    renderSection();
    const btn = (await screen.findByTestId(
      'findings-report-approve-button',
    )) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Couldn’t verify the current observations');
  });

  it('passes BOTH pins — the narrative version and the held digest', async () => {
    m(approveFindingsReport).mockResolvedValue({
      ok: true,
      data: { ...REPORT, approval_status: 'APPROVED', basis_digest: 'digest-live' },
    });
    renderSection();
    fireEvent.click(await screen.findByTestId('findings-report-approve-button'));
    await waitFor(() =>
      expect(m(approveFindingsReport)).toHaveBeenCalledWith(
        'fr1',
        REPORT.updated_at,
        'digest-live',
      ),
    );
    expect(await screen.findByText('Approved')).toBeTruthy();
  });

  it('blocks approve when the rendered blocks disagree with the server digest (stale/failed entries read)', async () => {
    // Zero blocks rendered, but the server digest names a real set — sealing
    // here would pin blocks the reviewer never saw.
    m(fetchWorkspaceEntries).mockResolvedValue([]);
    renderSection();
    expect(await screen.findByTestId('findings-report-basis-mismatch')).toBeTruthy();
    const btn = (await screen.findByTestId(
      'findings-report-approve-button',
    )) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('a genuinely empty entry set is consistent — no mismatch, approve enabled', async () => {
    m(fetchWorkspaceEntries).mockResolvedValue([]);
    m(fetchEntrySetDigest).mockResolvedValue(EMPTY_SET_DIGEST);
    renderSection();
    const btn = (await screen.findByTestId(
      'findings-report-approve-button',
    )) as HTMLButtonElement;
    expect(screen.queryByTestId('findings-report-basis-mismatch')).toBeNull();
    expect(btn.disabled).toBe(false);
  });

  it('STALE_BASIS reloads server truth and shows the basis-specific notice', async () => {
    m(approveFindingsReport).mockResolvedValue({
      ok: false,
      error: 'The observations this deliverable is built from changed since they were reviewed',
      errorHint: 'STALE_BASIS',
    });
    renderSection();
    fireEvent.click(await screen.findByTestId('findings-report-approve-button'));
    const notice = await screen.findByTestId('findings-report-stale-notice');
    expect(notice.textContent).toContain('What this deliverable is built from changed');
    // The reload refetched server truth (initial load + reload).
    expect(m(fetchFindingsReport).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('save honesty (PR-1 posture)', () => {
  it('a failed save banners, preserves the editor, and blocks approve', async () => {
    m(upsertFindingsReport).mockResolvedValue(null);
    renderSection();
    fireEvent.click(await screen.findByTestId('findings-report-edit-button'));
    fireEvent.change(screen.getByTestId('findings-report-intro-input'), {
      target: { value: 'Rewritten intro the save must not lose.' },
    });
    fireEvent.click(screen.getByTestId('findings-report-save-button'));
    expect(await screen.findByTestId('findings-report-save-error')).toBeTruthy();
    // Editor re-opened over the preserved content.
    const input = screen.getByTestId('findings-report-intro-input') as HTMLTextAreaElement;
    expect(input.value).toBe('Rewritten intro the save must not lose.');
    // Approve blocked while the save error stands.
    expect(
      (screen.getByTestId('findings-report-approve-button') as HTMLButtonElement).disabled,
    ).toBe(true);
    // Dismissing clears the error + draft together and returns to view mode.
    fireEvent.click(screen.getByLabelText('Discard the unsaved changes'));
    const btn = (await screen.findByTestId(
      'findings-report-approve-button',
    )) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('a successful save routes the trimmed narrative through the upsert', async () => {
    m(upsertFindingsReport).mockResolvedValue({
      ...REPORT,
      content: { intro_text: 'New intro.', closing_text: 'Next steps narrative.' },
      updated_at: '2026-09-06T11:00:00+00:00',
    });
    renderSection();
    fireEvent.click(await screen.findByTestId('findings-report-edit-button'));
    fireEvent.change(screen.getByTestId('findings-report-intro-input'), {
      target: { value: '  New intro.  ' },
    });
    fireEvent.click(screen.getByTestId('findings-report-save-button'));
    await waitFor(() =>
      expect(m(upsertFindingsReport)).toHaveBeenCalledWith('audit-1', {
        intro_text: 'New intro.',
        closing_text: 'Next steps narrative.',
      }),
    );
    expect(await screen.findByText('New intro.')).toBeTruthy();
  });
});

describe('divergence + preview lock', () => {
  it('sealed digest ≠ live digest on an approved report banners divergence', async () => {
    m(fetchFindingsReport).mockResolvedValue({
      report: {
        ...REPORT,
        approval_status: 'APPROVED',
        basis_digest: 'digest-sealed',
      },
      failed: false,
    });
    renderSection();
    const banner = await screen.findByTestId('findings-report-diverged');
    // The banner must name the path that exists while APPROVED (Revise
    // narrative → Save demotes to Draft → approve again) — when approved,
    // the latch row shows the Approved badge, not an Approve button.
    expect(banner.textContent).toContain('Revise narrative');
    expect(banner.textContent).toContain('revert the report to Draft');
    expect(banner.textContent).not.toContain('re-review');
  });

  it('no divergence claim while the live digest is unknown — unknown is not diverged', async () => {
    m(fetchEntrySetDigest).mockResolvedValue(null);
    m(fetchFindingsReport).mockResolvedValue({
      report: { ...REPORT, approval_status: 'APPROVED', basis_digest: 'digest-sealed' },
      failed: false,
    });
    renderSection();
    await screen.findByText('Audit purpose narrative.');
    expect(screen.queryByTestId('findings-report-diverged')).toBeNull();
  });

  it('previewing from ahead locks generation and editing', async () => {
    renderSection({ hasReached: false });
    const generate = (await screen.findByTestId(
      'findings_report-generate-button',
    )) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(
      (screen.getByTestId('findings-report-edit-button') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
