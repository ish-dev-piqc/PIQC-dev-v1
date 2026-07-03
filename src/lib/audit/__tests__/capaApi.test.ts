// Unit tests for capaApi — the Issues & CAPA read + RPC wrapper layer.
// Contract pinned here:
//   1. fetchIssuesWithCapas keys CAPAs by issue_id and degrades to empty
//      shapes (never throws) on query error.
//   2. Mutations pass the exact p_* params their RPCs expect and return null
//      on error (console.error'd) rather than throwing.
//   3. buildCapaPrefillFromFinding (pure) threads the finding's observation,
//      domain, and inherited risk context into the skeleton.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { supabase } from '../../supabase';
import {
  fetchIssuesWithCapas,
  createIssue,
  setCapaStatus,
  buildCapaPrefillFromFinding,
} from '../capaApi';
import type { MockWorkspaceEntry } from '../mockWorkspaceEntries';

const mockFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;
const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

// Chainable stub for .select('*').eq(...).order(...) — resolves to `result`
// at whichever link the API awaits (thenable at every depth).
function queryResolving(result: { data: unknown; error: unknown }) {
  const thenable = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  thenable.select.mockReturnValue(thenable);
  thenable.eq.mockReturnValue(thenable);
  thenable.order.mockReturnValue(thenable);
  return thenable;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

describe('fetchIssuesWithCapas', () => {
  it('returns issues + capas keyed by issue_id', async () => {
    const issue = { id: 'i1', audit_id: 'a1', title: 'Data gap' };
    const capa = { id: 'c1', issue_id: 'i1', audit_id: 'a1', status: 'DRAFT' };
    mockFrom.mockImplementation((table: string) =>
      table === 'issue_objects'
        ? queryResolving({ data: [issue], error: null })
        : queryResolving({ data: [capa], error: null }),
    );

    const result = await fetchIssuesWithCapas('a1');
    expect(result.issues).toHaveLength(1);
    expect(result.capasByIssue.i1).toMatchObject({ id: 'c1' });
  });

  it('degrades to empty shapes on issues query error (no throw)', async () => {
    mockFrom.mockImplementation(() =>
      queryResolving({ data: null, error: { message: 'RLS' } }),
    );
    const result = await fetchIssuesWithCapas('a1');
    expect(result).toEqual({ issues: [], capasByIssue: {} });
  });
});

describe('mutations', () => {
  it('createIssue passes exact p_* params and returns the row', async () => {
    const row = { id: 'i1', title: 'Data gap', severity: 'MAJOR' };
    mockRpc.mockResolvedValueOnce({ data: row, error: null });

    const result = await createIssue('a1', {
      title: 'Data gap',
      severity: 'MAJOR',
      workspaceEntryId: 'we1',
      regulatoryReportable: true,
    });

    expect(mockRpc).toHaveBeenCalledWith('audit_mode_create_issue', {
      p_audit_id: 'a1',
      p_title: 'Data gap',
      p_severity: 'MAJOR',
      p_description: '',
      p_workspace_entry_id: 'we1',
      p_regulatory_reportable: true,
      p_sponsor_reportable: false,
      p_reason: null,
    });
    expect(result).toEqual(row);
  });

  it('setCapaStatus returns null on RPC error (no throw)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'not ACCEPTED' } });
    const result = await setCapaStatus('c1', 'ACCEPTED');
    expect(result).toBeNull();
    errSpy.mockRestore();
  });
});

describe('buildCapaPrefillFromFinding (pure)', () => {
  const entry: MockWorkspaceEntry = {
    id: 'we1',
    audit_id: 'a1',
    protocol_risk_id: 'r1',
    vendor_service_mapping_id: null,
    questionnaire_response_id: null,
    checkpoint_ref: null,
    vendor_domain: 'Validation',
    observation_text: 'CSV evidence for the export pipeline was incomplete.',
    provisional_impact: 'MAJOR',
    provisional_classification: 'FINDING',
    inherited_endpoint_tier: 'PRIMARY',
    inherited_impact_surface: 'DATA_INTEGRITY',
    inherited_time_sensitivity: true,
    risk_context_outdated: false,
    source_extracted_item_id: null,
    created_by_name: 'Auditor',
    created_at: '2026-07-02T00:00:00Z',
  };

  it('threads observation, domain, and inherited risk context into the skeleton', () => {
    const prefill = buildCapaPrefillFromFinding('Data gap', entry);
    expect(prefill.rootCauseText).toContain('CSV evidence for the export pipeline');
    expect(prefill.rootCauseText).toContain('PRIMARY tier');
    expect(prefill.rootCauseText).toContain('data-integrity');
    expect(prefill.correctiveActionText).toContain('Validation');
    expect(prefill.preventiveActionText).toContain('Prevent recurrence');
  });

  it('falls back to the issue title when no finding is linked', () => {
    const prefill = buildCapaPrefillFromFinding('Untracked data gap', null);
    expect(prefill.rootCauseText).toContain('Untracked data gap');
    expect(prefill.rootCauseText).not.toContain('tier');
  });
});
