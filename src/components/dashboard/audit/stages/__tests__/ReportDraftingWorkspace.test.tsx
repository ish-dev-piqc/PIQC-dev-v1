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
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { MockReportDraft } from '../../../../../lib/audit/mockReport';

// -----------------------------------------------------------------------------
// Mocks — set up BEFORE importing the component under test.
// -----------------------------------------------------------------------------

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const mockAdvanceStage = vi.fn();
// workflow_type feeds hasReachedStage (UX2 one-ahead preview guard).
let mockActiveAudit: {
  id: string;
  current_stage: string;
  status: string;
  workflow_type: string;
} | null = {
  id: 'audit-1',
  current_stage: 'REPORT_DRAFTING',
  status: 'IN_PROGRESS',
  workflow_type: 'VENDOR_AUDIT',
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
function setupContext(draft: MockReportDraft | null, currentStage = 'REPORT_DRAFTING') {
  mockReportsMap = draft ? { 'audit-1': draft } : { 'audit-1': null };
  mockActiveAudit = {
    id: 'audit-1',
    current_stage: currentStage,
    status: 'IN_PROGRESS',
    workflow_type: 'VENDOR_AUDIT',
  };
}

// vi.mock factories are hoisted above top-level declarations, so the factory
// below would hit the class's temporal dead zone if this were a plain
// `class` statement. vi.hoisted() lifts the declaration alongside the mocks.
const { MockLlmError } = vi.hoisted(() => {
  class MockLlmError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'LlmExecutiveSummaryError';
      this.status = status;
    }
  }
  return { MockLlmError };
});

vi.mock('../../../../../lib/audit/reportApi', () => ({
  fetchReportDraft: vi.fn(),
  prefillReportDraft: vi.fn(),
  upsertReportDraft: vi.fn(),
  approveReportDraft: vi.fn(),
  requestLlmExecutiveSummary: vi.fn(),
  requestLlmConclusions: vi.fn(),
  LlmExecutiveSummaryError: MockLlmError,
}));

import ReportDraftingWorkspace from '../ReportDraftingWorkspace';
import {
  fetchReportDraft,
  prefillReportDraft,
  upsertReportDraft,
  approveReportDraft,
  requestLlmExecutiveSummary,
  requestLlmConclusions,
} from '../../../../../lib/audit/reportApi';

const mockFetch = fetchReportDraft as ReturnType<typeof vi.fn>;
const mockPrefill = prefillReportDraft as ReturnType<typeof vi.fn>;
const mockUpsert = upsertReportDraft as ReturnType<typeof vi.fn>;
const mockApprove = approveReportDraft as ReturnType<typeof vi.fn>;
const mockRequestLlm = requestLlmExecutiveSummary as ReturnType<typeof vi.fn>;
const mockRequestLlmConclusions = requestLlmConclusions as ReturnType<typeof vi.fn>;

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
    updated_at: '2026-05-16T00:00:00Z',
    final_signed_off_at: null,
    final_signed_off_by_name: null,
    exported_at: null,
    source_risk_summary_id: 'rs-1',
    prefilled_at: '2026-05-16T00:00:00Z',
    executive_summary_source: 'templated',
    // Default the conclusions provenance to 'auditor_edited' so the conclusions
    // auto-fire branch is OFF by default. Exec-summary-focused tests stay
    // single-branch and assert cleanly. Conclusions tests explicitly override
    // to 'templated' to exercise their branch.
    conclusions_source: 'auditor_edited',
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
    // First call: initial load. Second call: pre-write refetch from inside
    // the exec-summary auto-fire branch (added with conclusions LLM to avoid
    // clobbering a concurrent conclusions write). Both return the same
    // templated row since conclusions LLM is off (auditor_edited default).
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
    // AUD-301: upsertReportDraft now returns a discriminated result.
    mockUpsert.mockResolvedValueOnce({ ok: true, data: refinedDraft });

    render(<ReportDraftingWorkspace />);

    await waitFor(() => {
      expect(mockRequestLlm).toHaveBeenCalledTimes(1);
      expect(mockRequestLlm).toHaveBeenCalledWith('audit-1');
    });

    // The narrative must be persisted with the 'llm' provenance marker so the
    // audit trail records the LLM transition. The conclusionsSource (6th arg)
    // is undefined — exec-summary write should not touch conclusions provenance.
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
      expect.stringContaining('[ReportDraftingWorkspace] LLM exec-summary refinement failed'),
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

// =============================================================================
// Conclusions LLM auto-fire guards (this PR — mirrors exec-summary guards)
//
// The conclusions LLM refinement is a second auto-fire branch in the same
// useEffect. Same four-guard shape as exec summary (PR #69):
//
//   1. draft exists
//   2. draft.conclusions_source === 'templated'
//   3. draft.approval_status === 'DRAFT'
//   4. !attemptedLlmConclusionsRef.current.has(auditId)
//
// Independent failure modes from the exec-summary branch — a regression in
// conclusions guards wouldn't be caught by exec-summary tests because the
// underlying `?? null` / `=== 'templated'` decisions are duplicated in
// parallel branches.
//
// Hits the same "GUARD on approved" invariant — GxP-bad if approved reports
// silently demote back to DRAFT because a background conclusions refinement
// fired.
// =============================================================================

describe('ReportDraftingWorkspace — Conclusions LLM auto-fire guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrefill.mockResolvedValue(null);
    // Default conclusions LLM mock to never-resolve so a stray fire in an
    // exec-summary-focused test doesn't leak into assertions here.
    mockRequestLlmConclusions.mockImplementation(() => new Promise(() => {}));
  });

  it('FIRES + PERSISTS: conclusions_source="templated" + DRAFT → LLM runs, upserted with conclusionsSource="llm"', async () => {
    // Exec summary is 'auditor_edited' so its branch is OFF — only the
    // conclusions branch should fire. This isolates the conclusions assertion.
    const templatedConclusions = makeReportDraft({
      executive_summary_source: 'auditor_edited',
      conclusions_source: 'templated',
    });
    setupContext(templatedConclusions);
    mockFetch.mockResolvedValue(templatedConclusions);
    mockRequestLlmConclusions.mockReset();
    mockRequestLlmConclusions.mockResolvedValueOnce('AI-refined conclusions.');
    const refinedDraft = makeReportDraft({
      conclusions: 'AI-refined conclusions.',
      conclusions_source: 'llm',
    });
    // AUD-301: upsertReportDraft now returns a discriminated result.
    mockUpsert.mockResolvedValueOnce({ ok: true, data: refinedDraft });

    render(<ReportDraftingWorkspace />);

    await waitFor(() => {
      expect(mockRequestLlmConclusions).toHaveBeenCalledTimes(1);
      expect(mockRequestLlmConclusions).toHaveBeenCalledWith('audit-1');
    });

    // Upsert call shape: executiveSummarySource passes undefined (5th arg)
    // so the server preserves the previous exec-summary provenance;
    // conclusionsSource is 'llm' (6th arg) so the conclusions trail flips.
    // The asymmetry — only writing the field this branch owns — is the
    // contract that lets the two parallel branches not clobber each other.
    expect(mockUpsert).toHaveBeenCalledWith(
      'audit-1',
      templatedConclusions.executive_summary,
      'AI-refined conclusions.',
      'Conclusions refined by LLM',
      undefined,
      'llm',
    );

    await waitFor(() => {
      expect(mockSetReports).toHaveBeenCalled();
    });
  });

  it('GUARD: conclusions_source="llm" → conclusions LLM does NOT re-fire', async () => {
    const refined = makeReportDraft({
      executive_summary_source: 'auditor_edited',
      conclusions_source: 'llm',
      conclusions: 'Existing AI-drafted conclusions.',
    });
    setupContext(refined);
    mockFetch.mockResolvedValue(refined);

    render(<ReportDraftingWorkspace />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(mockRequestLlmConclusions).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('GUARD: conclusions_source="auditor_edited" → conclusions LLM does NOT re-fire', async () => {
    const edited = makeReportDraft({
      executive_summary_source: 'auditor_edited',
      conclusions_source: 'auditor_edited',
    });
    setupContext(edited);
    mockFetch.mockResolvedValue(edited);

    render(<ReportDraftingWorkspace />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(mockRequestLlmConclusions).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('GUARD: approval_status="APPROVED" → conclusions LLM does NOT fire (skip-on-approved)', async () => {
    // Same GxP invariant as exec summary: approved reports must never silently
    // demote back to DRAFT because of a background refinement.
    const approved = makeReportDraft({
      executive_summary_source: 'auditor_edited',
      conclusions_source: 'templated',
      approval_status: 'APPROVED',
      approved_at: '2026-05-16T01:00:00Z',
    });
    setupContext(approved);
    mockFetch.mockResolvedValue(approved);

    render(<ReportDraftingWorkspace />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(mockRequestLlmConclusions).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('FALLBACK: conclusions LLM throws → templated stays, console.warn fires, fallback note renders', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const templatedConclusions = makeReportDraft({
      executive_summary_source: 'auditor_edited',
      conclusions_source: 'templated',
    });
    setupContext(templatedConclusions);
    mockFetch.mockResolvedValue(templatedConclusions);
    mockRequestLlmConclusions.mockReset();
    mockRequestLlmConclusions.mockRejectedValueOnce(new MockLlmError('Service unavailable', 502));

    render(<ReportDraftingWorkspace />);

    await waitFor(() => {
      expect(screen.getByTestId('conclusions-llm-fallback')).toBeInTheDocument();
    });

    expect(mockRequestLlmConclusions).toHaveBeenCalledOnce();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ReportDraftingWorkspace] LLM conclusions refinement failed'),
      expect.anything(),
    );

    warnSpy.mockRestore();
  });

  it('UI: conclusions source chip swaps to "Drafting with AI…" during refinement', async () => {
    let resolveLlm: (value: string) => void = () => {};
    const llmPromise = new Promise<string>((resolve) => {
      resolveLlm = resolve;
    });
    const templatedConclusions = makeReportDraft({
      executive_summary_source: 'auditor_edited',
      conclusions_source: 'templated',
    });
    setupContext(templatedConclusions);
    mockFetch.mockResolvedValue(templatedConclusions);
    mockRequestLlmConclusions.mockReset();
    mockRequestLlmConclusions.mockReturnValueOnce(llmPromise);

    try {
      render(<ReportDraftingWorkspace />);

      await waitFor(() => {
        const chip = screen.getByTestId('conclusions-source-chip');
        expect(chip).toHaveAttribute('data-source', 'refining');
        expect(chip).toHaveTextContent(/drafting with ai/i);
      });
    } finally {
      resolveLlm('AI-refined conclusions.');
    }
  });

  it('UI: conclusions Edit button disabled during refinement', async () => {
    let resolveLlm: (value: string) => void = () => {};
    const llmPromise = new Promise<string>((resolve) => {
      resolveLlm = resolve;
    });
    const templatedConclusions = makeReportDraft({
      executive_summary_source: 'auditor_edited',
      conclusions_source: 'templated',
    });
    setupContext(templatedConclusions);
    mockFetch.mockResolvedValue(templatedConclusions);
    mockRequestLlmConclusions.mockReset();
    mockRequestLlmConclusions.mockReturnValueOnce(llmPromise);

    try {
      render(<ReportDraftingWorkspace />);

      await waitFor(() => {
        const editButton = screen.getByTestId('conclusions-edit-button');
        expect(editButton).toBeDisabled();
        expect(editButton).toHaveAttribute(
          'title',
          expect.stringContaining('Wait for the agent'),
        );
      });
    } finally {
      resolveLlm('AI-refined conclusions.');
    }
  });
});

// =============================================================================
// PR #80 — PIQC write-back landing note.
//
// When AuditWorkspaceShell completes a successful onAssistantWriteback, it
// hands the matching workspace a transient `landingNotice` prop. Stage 7
// renders a PIQC-voiced dismissible note above the receiving section.
// These tests lock the four contracts that matter:
//
//   1. No landingNotice → no note rendered (default state unchanged)
//   2. landingNotice for executive_summary → note above exec section only
//   3. landingNotice for conclusions → note above conclusions section only
//   4. Dismiss click invokes onDismissLandingNotice (shell clears state)
//
// The shell's own state lifecycle (clear-on-audit-switch, clear-on-stage-
// navigation, set-on-writeback-success) is covered by manual QA. Same
// precedent as PR #76's onSignalAction and PR #79's onAssistantWriteback
// — shell-side wiring is integration territory; per-component contract
// is what these tests lock.
// =============================================================================

describe('ReportDraftingWorkspace — PIQC write-back landing note (PR #80)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext(makeReportDraft({
      // Both sources non-templated so neither auto-fire branch triggers
      // during the test render. Keeps the landing-note assertions clean
      // and free of LLM-side noise.
      executive_summary_source: 'auditor_edited',
      conclusions_source:       'auditor_edited',
    }));
    mockFetch.mockResolvedValue(makeReportDraft({
      executive_summary_source: 'auditor_edited',
      conclusions_source:       'auditor_edited',
    }));
  });

  it('renders no note when landingNotice is null/undefined (default)', () => {
    render(<ReportDraftingWorkspace />);
    expect(screen.queryByTestId('piqc-landing-note-executive_summary'))
      .not.toBeInTheDocument();
    expect(screen.queryByTestId('piqc-landing-note-conclusions'))
      .not.toBeInTheDocument();
  });

  it('renders the exec-summary note above the exec section, not the conclusions section', () => {
    render(
      <ReportDraftingWorkspace
        landingNotice={{ field: 'executive_summary', at: Date.now() }}
        onDismissLandingNotice={vi.fn()}
      />,
    );
    const note = screen.getByTestId('piqc-landing-note-executive_summary');
    expect(note).toBeInTheDocument();
    expect(screen.queryByTestId('piqc-landing-note-conclusions'))
      .not.toBeInTheDocument();
    // Voice check — first-person partner consistent with chat panel's
    // empty-state primer + confirm copy. Locks against drift back to
    // third-person system voice.
    expect(note).toHaveTextContent(/Just dropped this into your exec summary/i);
    // A11y — role="status" makes the note's appearance announceable to
    // screen-reader users (implies aria-live="polite"). Without this,
    // SR users would land on Stage 7 with new textarea text but no
    // signal that PIQC just put it there. Locked so a future styling
    // pass doesn't silently strip the role.
    expect(note).toHaveAttribute('role', 'status');
  });

  it('renders the conclusions note above the conclusions section, not the exec section', () => {
    render(
      <ReportDraftingWorkspace
        landingNotice={{ field: 'conclusions', at: Date.now() }}
        onDismissLandingNotice={vi.fn()}
      />,
    );
    expect(screen.getByTestId('piqc-landing-note-conclusions'))
      .toBeInTheDocument();
    expect(screen.queryByTestId('piqc-landing-note-executive_summary'))
      .not.toBeInTheDocument();
    expect(screen.getByTestId('piqc-landing-note-conclusions'))
      .toHaveTextContent(/Just dropped this into your conclusions/i);
  });

  it('invokes onDismissLandingNotice when the dismiss button is clicked', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <ReportDraftingWorkspace
        landingNotice={{ field: 'executive_summary', at: Date.now() }}
        onDismissLandingNotice={onDismiss}
      />,
    );

    await user.click(screen.getByTestId('piqc-landing-note-dismiss-executive_summary'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders the note WITHOUT a dismiss button when onDismissLandingNotice is omitted', () => {
    // Defensive shape — a future caller that wants to render the note
    // without enabling dismiss (e.g., readonly viewing of past state)
    // should not hit a render error.
    render(
      <ReportDraftingWorkspace
        landingNotice={{ field: 'conclusions', at: Date.now() }}
      />,
    );
    expect(screen.getByTestId('piqc-landing-note-conclusions')).toBeInTheDocument();
    expect(screen.queryByTestId('piqc-landing-note-dismiss-conclusions'))
      .not.toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Readiness latch (audit-export-readiness spec)
//
// The "Mark ready to export" latch attests to exactly the content the reviewer
// saw: it must not arm while either LLM refine is mutating the text, it must
// thread the row version (updated_at) into the server CAS, and a STALE_CONTENT
// rejection must refetch + surface the invitational re-review note.
// -----------------------------------------------------------------------------

describe('ReportDraftingWorkspace — readiness latch (export-readiness spec)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrefill.mockResolvedValue(null);
  });

  it('DISABLED DURING REFINE: latch is disabled while the exec-summary LLM is in flight', async () => {
    const templated = makeReportDraft({ executive_summary_source: 'templated' });
    setupContext(templated);
    mockFetch.mockResolvedValue(templated);
    // Never-resolving LLM call keeps llmRefining=true for the whole test.
    mockRequestLlm.mockReturnValue(new Promise(() => {}));

    render(<ReportDraftingWorkspace />);

    await waitFor(() => expect(mockRequestLlm).toHaveBeenCalled());
    const latch = screen.getByRole('button', { name: /mark ready to export/i });
    expect(latch).toBeDisabled();
  });

  it('CAS THREADING: latch passes the rendered row version to approveReportDraft', async () => {
    // source='llm' keeps both auto-fire branches off — the latch is enabled.
    const draft = makeReportDraft({
      executive_summary_source: 'llm',
      conclusions_source: 'llm',
      updated_at: '2026-05-20T12:34:56Z',
    });
    setupContext(draft);
    mockFetch.mockResolvedValue(draft);
    mockApprove.mockResolvedValue({
      ok: true,
      data: makeReportDraft({ approval_status: 'APPROVED' }),
    });

    render(<ReportDraftingWorkspace />);

    const latch = await screen.findByRole('button', { name: /mark ready to export/i });
    await waitFor(() => expect(latch).not.toBeDisabled());
    fireEvent.click(latch);

    await waitFor(() => {
      expect(mockApprove).toHaveBeenCalledWith('rd-1', '2026-05-20T12:34:56Z');
    });
  });

  it('STALE RECOVERY: STALE_CONTENT rejection refetches and shows the re-review note', async () => {
    const draft = makeReportDraft({
      executive_summary_source: 'llm',
      conclusions_source: 'llm',
    });
    setupContext(draft);
    mockFetch.mockResolvedValue(draft);
    mockApprove.mockResolvedValue({
      ok: false,
      error: 'Report changed since it was last reviewed',
      errorHint: 'STALE_CONTENT',
    });

    render(<ReportDraftingWorkspace />);

    const latch = await screen.findByRole('button', { name: /mark ready to export/i });
    await waitFor(() => expect(latch).not.toBeDisabled());
    const fetchCallsBeforeApprove = mockFetch.mock.calls.length;
    fireEvent.click(latch);

    // Recovery contract: refetch server truth, then the invitational note.
    await waitFor(() => {
      expect(mockFetch.mock.calls.length).toBeGreaterThan(fetchCallsBeforeApprove);
    });
    expect(
      await screen.findByText(/changed since you last reviewed it/i),
    ).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// PR-UX2 — one-ahead preview guard. The shell's nav allows viewing Stage 7
// while the audit is still at Stage 6; previewing must be a pure read — no
// prefill RPC, no LLM spend, no stub affordance — with the preview notice up.
// -----------------------------------------------------------------------------

describe('ReportDraftingWorkspace — one-ahead preview guard (PR-UX2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PREVIEW, no draft: prefill does NOT fire, notice renders, stub button absent', async () => {
    setupContext(null, 'AUDIT_CONDUCT');
    mockFetch.mockResolvedValue(null);

    render(<ReportDraftingWorkspace />);

    // The load effect still reads (previews render real data)…
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('audit-1'));
    // …but writes and spend stay off.
    expect(mockPrefill).not.toHaveBeenCalled();
    expect(mockRequestLlm).not.toHaveBeenCalled();
    expect(mockRequestLlmConclusions).not.toHaveBeenCalled();
    expect(screen.getByText(/has not reached this stage yet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /generate report stub/i }),
    ).not.toBeInTheDocument();
  });

  it('PREVIEW, templated draft present: LLM refinement does NOT fire even though every PR #69 guard passes', async () => {
    const templated = makeReportDraft({
      executive_summary_source: 'templated',
      conclusions_source: 'templated',
    });
    setupContext(templated, 'AUDIT_CONDUCT');
    mockFetch.mockResolvedValue(templated);

    render(<ReportDraftingWorkspace />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockRequestLlm).not.toHaveBeenCalled();
    expect(mockRequestLlmConclusions).not.toHaveBeenCalled();
    expect(mockPrefill).not.toHaveBeenCalled();
    expect(screen.getByText(/has not reached this stage yet/i)).toBeInTheDocument();
  });
});
