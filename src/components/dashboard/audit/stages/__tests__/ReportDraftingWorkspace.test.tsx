// Unit tests for Stage 7 LLM auto-fire guards (PR #69).
//
// PR #69 introduced four guards in the auto-fire useEffect that decides
// whether to call the audit-summary edge function on Stage 7 open:
//
//   1. draft exists (templated prefill landed)
//   2. draft.executive_summary_source === 'templated'
//      (don't re-refine an llm or auditor_edited draft)
//   3. draft.approval_status === 'DRAFT'
//      (don't silently demote an approved draft back to DRAFT by refining)
//   4. !attemptedLlmRef.current.has(auditId)
//      (in-session idempotency)
//
// Each guard is a separate failure mode if regressed:
//   - #1 fail → null-deref on draft.executive_summary_source
//   - #2 fail → LLM re-fires on every open, wiping auditor edits
//   - #3 fail → approved reports silently demote to DRAFT — GxP-bad
//   - #4 fail → cost spiral; one LLM call per render
//
// Tests also cover the success-persist path (upsert with source='llm')
// and the silent-with-signal fallback (console.warn + fallback note in DOM).
//
// SURFACE DECISIONS (extends PR #66 component-test precedent):
//   - vi.mock context modules (ThemeContext, AuditContext, AuditDataContext)
//     rather than wrapping in real providers. AuditDataContext is heavy
//     (9 stores); a real wrapper would force seeding all of them. Mock
//     useAuditData with the minimum shape the workspace destructures.
//   - vi.mock the entire reportApi module — drive auto-fire decisions via
//     fetchReportDraft return values; assert the right downstream calls.
//   - The auto-fire useEffect reads from a LOCAL `draft` variable (not
//     from the reports context store), so we don't need stateful context
//     mocks for the guard-decision tests. The fallback-note render test
//     does need the source to stay 'templated' in the render-time data,
//     which we control via the useAuditData mock's reports record.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { MockReportDraft } from '../../../../../lib/audit/mockReport';

// -----------------------------------------------------------------------------
// Mocks — set up BEFORE importing the component under test.
// -----------------------------------------------------------------------------

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const mockAdvanceStage = vi.fn();
let mockActiveAudit: { id: string; current_stage: string; status: string } | null = {
  id: 'audit-1',
  current_stage: 'REPORT_DRAFTING',
  status: 'IN_PROGRESS',
};
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    audits: [],
    setActiveAudit: vi.fn(),
    refresh: vi.fn(),
    advanceStage: mockAdvanceStage,
  }),
}));

// Reports map is read at render time. We seed it in beforeEach so the
// rendered draft matches what fetchReportDraft returns on load.
let mockReportsMap: Record<string, MockReportDraft | null> = {};
const mockSetReports = vi.fn();
vi.mock('../../../../../context/AuditDataContext', () => ({
  useAuditData: () => ({
    protocolRisks: {}, setProtocolRisks: vi.fn(),
    vendorServices: {}, setVendorServices: vi.fn(),
    serviceMappings: {}, setServiceMappings: vi.fn(),
    trustAssessments: {}, setTrustAssessments: vi.fn(),
    riskSummaries: {}, setRiskSummaries: vi.fn(),
    questionnaires: {}, setQuestionnaires: vi.fn(),
    preAuditBundles: {}, setPreAuditBundles: vi.fn(),
    workspaceEntries: { 'audit-1': [] }, setWorkspaceEntries: vi.fn(),
    reports: mockReportsMap,
    setReports: mockSetReports,
  }),
}));

class MockLlmError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'LlmExecutiveSummaryError';
    this.status = status;
  }
}

vi.mock('../../../../../lib/audit/reportApi', () => ({
  fetchReportDraft: vi.fn(),
  prefillReportDraft: vi.fn(),
  upsertReportDraft: vi.fn(),
  approveReportDraft: vi.fn(),
  requestLlmExecutiveSummary: vi.fn(),
  LlmExecutiveSummaryError: MockLlmError,
}));

import ReportDraftingWorkspace from '../ReportDraftingWorkspace';
import {
  fetchReportDraft,
  prefillReportDraft,
  upsertReportDraft,
  requestLlmExecutiveSummary,
} from '../../../../../lib/audit/reportApi';

const mockFetch = fetchReportDraft as ReturnType<typeof vi.fn>;
const mockPrefill = prefillReportDraft as ReturnType<typeof vi.fn>;
const mockUpsert = upsertReportDraft as ReturnType<typeof vi.fn>;
const mockRequestLlm = requestLlmExecutiveSummary as ReturnType<typeof vi.fn>;

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function makeReportDraft(overrides: Partial<MockReportDraft> = {}): MockReportDraft {
  return {
    id: 'rd-1',
    audit_id: 'audit-1',
    executive_summary: 'Templated draft text.',
    conclusions: 'Templated conclusions text.',
    approval_status: 'DRAFT',
    approved_at: null,
    approved_by_name: null,
    final_signed_off_at: null,
    final_signed_off_by_name: null,
    exported_at: null,
    source_risk_summary_id: 'rs-1',
    prefilled_at: '2026-05-16T00:00:00Z',
    executive_summary_source: 'templated',
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('ReportDraftingWorkspace — LLM auto-fire guards (PR #69)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReportsMap = {};
    mockActiveAudit = {
      id: 'audit-1',
      current_stage: 'REPORT_DRAFTING',
      status: 'IN_PROGRESS',
    };
    mockPrefill.mockResolvedValue(null);
    mockUpsert.mockResolvedValue(null);
  });

  it('FIRES + PERSISTS: templated draft + DRAFT status → LLM runs, result upserted with source="llm"', async () => {
    const templated = makeReportDraft({ executive_summary_source: 'templated' });
    mockFetch.mockResolvedValue(templated);
    mockReportsMap = { 'audit-1': templated };
    mockRequestLlm.mockResolvedValueOnce('AI-refined narrative.');

    render(<ReportDraftingWorkspace />);

    await waitFor(() => {
      expect(mockRequestLlm).toHaveBeenCalledTimes(1);
      expect(mockRequestLlm).toHaveBeenCalledWith('audit-1');
    });

    // The narrative must be persisted with the 'llm' provenance marker so the
    // audit trail records the LLM transition.
    expect(mockUpsert).toHaveBeenCalledWith(
      'audit-1',
      'AI-refined narrative.',
      templated.conclusions,
      'Executive summary refined by LLM',
      'llm',
    );
  });

  it('GUARD: source="llm" → LLM does NOT re-fire (already refined)', async () => {
    // Defensive — if a refresh / re-mount happens on an already-LLM-refined
    // draft, we must not re-prompt OpenAI and wipe the existing narrative.
    const refined = makeReportDraft({
      executive_summary_source: 'llm',
      executive_summary: 'Existing AI-drafted narrative.',
    });
    mockFetch.mockResolvedValue(refined);
    mockReportsMap = { 'audit-1': refined };

    render(<ReportDraftingWorkspace />);

    // Give the effect time to chain through fetchReportDraft.
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    // Then assert no LLM call ever fired. Small delay lets a buggy
    // implementation surface — without this, the assertion races against
    // any pending microtask that might still call.
    await Promise.resolve(); // flush one microtask tick so the LLM-decision branch has run
    expect(mockRequestLlm).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('GUARD: source="auditor_edited" → LLM does NOT re-fire (auditor took over)', async () => {
    const edited = makeReportDraft({
      executive_summary_source: 'auditor_edited',
      executive_summary: 'Auditor-written narrative.',
    });
    mockFetch.mockResolvedValue(edited);
    mockReportsMap = { 'audit-1': edited };

    render(<ReportDraftingWorkspace />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await Promise.resolve(); // flush one microtask tick so the LLM-decision branch has run
    expect(mockRequestLlm).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('GUARD: approval_status="APPROVED" → LLM does NOT fire (skip-on-approved)', async () => {
    // THE INVARIANT: an approved report must not silently demote back to
    // DRAFT because of a background LLM refinement. This is the highest-
    // stakes guard — GxP audit trails must not be silently broken.
    const approved = makeReportDraft({
      executive_summary_source: 'templated',
      approval_status: 'APPROVED',
      approved_at: '2026-05-16T01:00:00Z',
    });
    mockFetch.mockResolvedValue(approved);
    mockReportsMap = { 'audit-1': approved };

    render(<ReportDraftingWorkspace />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await Promise.resolve(); // flush one microtask tick so the LLM-decision branch has run
    expect(mockRequestLlm).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('FALLBACK: LLM throws → templated stays, console.warn fires, fallback note renders', async () => {
    // Silent-with-signal fallback contract:
    //   - upsertReportDraft is NOT called (templated text stays intact server-side)
    //   - console.warn fires with a tagged message (debug signal for dev team)
    //   - the dismissable fallback note appears in the DOM (auditor signal)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const templated = makeReportDraft({ executive_summary_source: 'templated' });
    mockFetch.mockResolvedValue(templated);
    mockReportsMap = { 'audit-1': templated };
    mockRequestLlm.mockRejectedValueOnce(new MockLlmError('Service unavailable', 502));

    render(<ReportDraftingWorkspace />);

    // Fallback note surfaces inline once the catch block runs setLlmFallback.
    await waitFor(() => {
      expect(screen.getByTestId('exec-summary-llm-fallback')).toBeInTheDocument();
    });

    expect(mockRequestLlm).toHaveBeenCalledOnce();
    // Critical: NO upsert with 'llm' source. The templated row server-side
    // is untouched.
    expect(mockUpsert).not.toHaveBeenCalled();
    // Dev-team debug signal preserved even though the UX degraded gracefully.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ReportDraftingWorkspace] LLM refinement failed'),
      expect.anything(),
    );

    warnSpy.mockRestore();
  });
});
