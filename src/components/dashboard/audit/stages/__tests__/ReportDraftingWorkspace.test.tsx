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

// Reports map is read at render time. We seed it via setupContext() in each
// test so the rendered draft matches what fetchReportDraft returns on load.
// The let-binding is captured by the vi.mock factory; setupContext mutates
// the let so the factory's next call sees the new value.
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

/**
 * Forces explicit per-test seeding of the mocked context state. Without this
 * helper, a test that forgets to set mockReportsMap inherits the previous
 * test's state (beforeEach reassigns to {} but the failure mode is implicit).
 * Pass the draft you want both fetchReportDraft and useAuditData.reports to
 * return; pass null for "no draft on the audit."
 */
function setupContext(draft: MockReportDraft | null) {
  mockReportsMap = draft ? { 'audit-1': draft } : { 'audit-1': null };
  mockActiveAudit = {
    id: 'audit-1',
    current_stage: 'REPORT_DRAFTING',
    status: 'IN_PROGRESS',
  };
}

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
    mockPrefill.mockResolvedValue(null);
  });

  it('FIRES + PERSISTS: templated draft + DRAFT status → LLM runs, result upserted with source="llm" AND propagates back to context', async () => {
    const templated = makeReportDraft({ executive_summary_source: 'templated' });
    setupContext(templated);
    mockFetch.mockResolvedValue(templated);
    mockRequestLlm.mockResolvedValueOnce('AI-refined narrative.');
    // Upsert returns the refined row so the propagation path through
    // setReports is exercised. If the production code's
    // `if (refined) setReports(...)` ever flips to swallow the result,
    // the mockSetReports assertion below catches it.
    const refinedDraft = makeReportDraft({
      executive_summary: 'AI-refined narrative.',
      executive_summary_source: 'llm',
    });
    mockUpsert.mockResolvedValueOnce(refinedDraft);

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

    // Propagation path: the refined row must reach the context store so the
    // UI flips its source chip from "Templated draft" to "AI-drafted". This
    // catches the regression class "upsert returns undefined silently and
    // the UI never sees the refinement."
    await waitFor(() => {
      expect(mockSetReports).toHaveBeenCalled();
    });
  });

  it('GUARD: source="llm" → LLM does NOT re-fire (already refined)', async () => {
    // Defensive — if a refresh / re-mount happens on an already-LLM-refined
    // draft, we must not re-prompt OpenAI and wipe the existing narrative.
    const refined = makeReportDraft({
      executive_summary_source: 'llm',
      executive_summary: 'Existing AI-drafted narrative.',
    });
    setupContext(refined);
    mockFetch.mockResolvedValue(refined);

    render(<ReportDraftingWorkspace />);

    // Give the effect time to chain through fetchReportDraft.
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    // Then assert no LLM call ever fired. The microtask flush lets a buggy
    // implementation's pending decision branch fire and fail loudly.
    await Promise.resolve(); // flush one microtask tick so the LLM-decision branch has run
    expect(mockRequestLlm).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('GUARD: source="auditor_edited" → LLM does NOT re-fire (auditor took over)', async () => {
    const edited = makeReportDraft({
      executive_summary_source: 'auditor_edited',
      executive_summary: 'Auditor-written narrative.',
    });
    setupContext(edited);
    mockFetch.mockResolvedValue(edited);

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
    setupContext(approved);
    mockFetch.mockResolvedValue(approved);

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
    setupContext(templated);
    mockFetch.mockResolvedValue(templated);
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

// =============================================================================
// Agentic-UX assertions
//
// PR #69 + #70 covered the LLM-decision GUARDS (correctness). This block covers
// the user-visible AGENTIC FEEL — the surfaces a future refactor could break
// silently while the guards still pass:
//
//   - The unified "Drafting with AI…" chip during the refinement window
//   - The Edit button disabled while the agent is drafting
//   - The "Drafted with AI" success banner appearing after LLM resolves
//   - The fallback note's invitational copy (not remedial)
//
// These map to the /design-critique north-star refinements from the agentic-UX
// pass: collapse cognitive load, one signal per moment, agentic-positive copy.
// =============================================================================

describe('ReportDraftingWorkspace — agentic-UX assertions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrefill.mockResolvedValue(null);
  });

  it('UI: source chip swaps to unified "Drafting with AI…" state during refinement', async () => {
    // Hold the LLM promise open so we can assert on the in-flight UI before
    // it resolves. Without this gating, the spinner-state would race against
    // the post-resolve render and flake. The promise is resolved in the
    // finally block so an assertion throw still leaves the promise settled
    // (avoids pending-promise warnings from the test runner).
    let resolveLlm: (value: string) => void = () => {};
    const llmPromise = new Promise<string>((resolve) => {
      resolveLlm = resolve;
    });
    const templated = makeReportDraft({ executive_summary_source: 'templated' });
    setupContext(templated);
    mockFetch.mockResolvedValue(templated);
    mockRequestLlm.mockReturnValueOnce(llmPromise);

    try {
      render(<ReportDraftingWorkspace />);

      // While the LLM call is in-flight, the source chip should read the
      // unified "Drafting with AI…" state. data-source="refining" is the
      // contract a future refactor must preserve.
      await waitFor(() => {
        const chip = screen.getByTestId('exec-summary-source-chip');
        expect(chip).toHaveAttribute('data-source', 'refining');
        expect(chip).toHaveTextContent(/drafting with ai/i);
      });
    } finally {
      // Always resolve so the component's async chain can complete cleanly.
      resolveLlm('AI-refined narrative.');
    }
  });

  it('UI: Edit button disabled during refinement to prevent edits on text about to be replaced', async () => {
    let resolveLlm: (value: string) => void = () => {};
    const llmPromise = new Promise<string>((resolve) => {
      resolveLlm = resolve;
    });
    const templated = makeReportDraft({ executive_summary_source: 'templated' });
    setupContext(templated);
    mockFetch.mockResolvedValue(templated);
    mockRequestLlm.mockReturnValueOnce(llmPromise);

    try {
      render(<ReportDraftingWorkspace />);

      // Use the production data-testid rather than getByRole('button', { name })
      // because TWO Edit buttons render (executive summary + conclusions);
      // the role+name selector would throw on multiple matches.
      await waitFor(() => {
        const editButton = screen.getByTestId('exec-summary-edit-button');
        expect(editButton).toBeDisabled();
        // Disabled-state reason should be carried by the title attribute so
        // it reaches both visible tooltip and screen readers — addresses the
        // "system is broken vs agent is working" tone gap.
        expect(editButton).toHaveAttribute(
          'title',
          expect.stringContaining('Wait for the agent'),
        );
      });
    } finally {
      resolveLlm('AI-refined narrative.');
    }
  });

  it('UI: "Drafted with AI" banner appears when source === "llm" (success state)', async () => {
    // Render directly with source='llm' already in place — the banner mounts
    // off the rendered report state, independent of how the LLM call resolved.
    const refined = makeReportDraft({
      executive_summary_source: 'llm',
      executive_summary: 'AI-drafted narrative.',
    });
    setupContext(refined);
    mockFetch.mockResolvedValue(refined);

    render(<ReportDraftingWorkspace />);

    // The PrefillAgentNote sets data-testid="prefill-agent-note" — the
    // shared component reuse from PRs #58 + #62 means the same testid
    // identifies the banner across all three stages that use it.
    await waitFor(() => {
      const banner = screen.getByTestId('prefill-agent-note');
      // Banner text identifies it as the LLM-specific instance vs the
      // templated-prefill instance.
      expect(banner).toHaveTextContent(/drafted with ai/i);
      expect(banner).toHaveTextContent(/refined from your approved/i);
    });
  });

  it('UI: fallback copy is invitational, not remedial', async () => {
    // North-star copy contract: the auditor never reads "AI failed" or
    // "temporarily unavailable" in the GENERIC failure case. The console.warn
    // upstream carries that signal for the dev team. The visible note pivots
    // to "Starting from your templated draft — edit below." — same surface,
    // agentic-positive tone.
    //
    // Server-specific errors (e.g. 409 "Stage 4 not approved") still surface
    // their actionable message verbatim; this test covers the GENERIC case.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const templated = makeReportDraft({ executive_summary_source: 'templated' });
    setupContext(templated);
    mockFetch.mockResolvedValue(templated);
    // Throw a plain Error (not LlmExecutiveSummaryError) to exercise the
    // generic-fallback copy path. The class-narrowing check in the catch
    // block routes server errors through err.message and everything else
    // through the invitational generic message.
    mockRequestLlm.mockRejectedValueOnce(new Error('network died'));

    render(<ReportDraftingWorkspace />);

    await waitFor(() => {
      const note = screen.getByTestId('exec-summary-llm-fallback');
      expect(note).toHaveTextContent(/starting from your templated draft/i);
      // Hard negatives — the remedial phrasings must NOT appear in the
      // visible note. If a future copy change reintroduces them, this fails.
      expect(note).not.toHaveTextContent(/temporarily unavailable/i);
      expect(note).not.toHaveTextContent(/ai (refinement|service) failed/i);
    });

    warnSpy.mockRestore();
  });
});
