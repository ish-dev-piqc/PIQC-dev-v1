// Unit tests for lineageApi — the fetch-composition layer behind the
// traceability drawer. lineageApi owns no logic of its own beyond "fan the
// nine existing per-audit reads out in parallel, hand them to the pure
// buildLineageGraph, and wrap the outcome in a Result". The contract worth
// pinning: it returns ok:true with a real graph when reads succeed, and
// ok:false (never a throw) when a read rejects.
//
// The nine sibling read modules are mocked so no supabase client is touched;
// buildLineageGraph runs for real (it's pure).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditWithContext } from '../../../context/AuditContext';

vi.mock('../intakeApi', () => ({ fetchProtocolRisksForAudit: vi.fn() }));
vi.mock('../vendorEnrichmentApi', () => ({
  fetchVendorService: vi.fn(),
  fetchServiceMappingsByAudit: vi.fn(),
  fetchTrustAssessment: vi.fn(),
}));
vi.mock('../questionnaireApi', () => ({ fetchQuestionnaireBundle: vi.fn() }));
vi.mock('../riskSummaryApi', () => ({ fetchRiskSummary: vi.fn() }));
vi.mock('../preAuditApi', () => ({ fetchPreAuditDeliverables: vi.fn() }));
vi.mock('../workspaceEntriesApi', () => ({ fetchWorkspaceEntries: vi.fn() }));
vi.mock('../capaApi', () => ({ fetchIssuesWithCapas: vi.fn() }));
vi.mock('../reportApi', () => ({ fetchReportDraft: vi.fn() }));
vi.mock('../findingsReport', () => ({ fetchFindingsReport: vi.fn() }));

import { fetchAuditLineage } from '../lineageApi';
import { fetchProtocolRisksForAudit } from '../intakeApi';
import {
  fetchVendorService,
  fetchServiceMappingsByAudit,
  fetchTrustAssessment,
} from '../vendorEnrichmentApi';
import { fetchQuestionnaireBundle } from '../questionnaireApi';
import { fetchRiskSummary } from '../riskSummaryApi';
import { fetchPreAuditDeliverables } from '../preAuditApi';
import { fetchWorkspaceEntries } from '../workspaceEntriesApi';
import { fetchIssuesWithCapas } from '../capaApi';
import { fetchReportDraft } from '../reportApi';
import { fetchFindingsReport } from '../findingsReport';

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const AUDIT: AuditWithContext = {
  id: 'a1',
  audit_name: 'Q3 ePRO vendor audit',
  audit_type: 'REMOTE',
  workflow_type: 'VENDOR_AUDIT',
  status: 'IN_PROGRESS',
  current_stage: 'AUDIT_CONDUCT',
  scheduled_date: null,
  scheduled_end_date: null,
  vendor_name: 'Acme ePRO GmbH',
  auditee_name: 'Acme ePRO GmbH',
  site_number: null,
  principal_investigator: null,
  site_country: null,
  protocol_code: 'BRT-2',
  protocol_title: 'BRIGHTEN-2',
  clinical_trial_phase: 'PHASE_2',
  protocol_id: 'p1',
  protocol_version_id: 'pv1',
};

beforeEach(() => {
  m(fetchProtocolRisksForAudit).mockResolvedValue([]);
  // PR-2 shape: the vendor trio returns Result<T>; lineage unwraps ok/data.
  m(fetchVendorService).mockResolvedValue({ ok: true, data: null });
  m(fetchServiceMappingsByAudit).mockResolvedValue({ ok: true, data: [] });
  m(fetchTrustAssessment).mockResolvedValue({ ok: true, data: null });
  m(fetchQuestionnaireBundle).mockResolvedValue(null);
  m(fetchRiskSummary).mockResolvedValue(null);
  // PR-1 shape: { bundle, failedKinds } — lineageApi unwraps .bundle.
  m(fetchPreAuditDeliverables).mockResolvedValue({
    bundle: {
      confirmation_letter: null,
      agenda: null,
      checklist: null,
      internal_notification: null,
      evidence_gap_summary: null,
    },
    failedKinds: [],
  });
  m(fetchWorkspaceEntries).mockResolvedValue([]);
  m(fetchIssuesWithCapas).mockResolvedValue({ issues: [], capasByIssue: {} });
  m(fetchReportDraft).mockResolvedValue(null);
  // PR-D4 shape: { report, failed } — lineageApi unwraps .report; a failed
  // read is omitted from the graph like an absent one.
  m(fetchFindingsReport).mockResolvedValue({ report: null, failed: false });
});

describe('fetchAuditLineage', () => {
  it('composes the reads into an ok Result with the seed→audit spine', async () => {
    const result = await fetchAuditLineage(AUDIT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Empty audit → seed + audit only.
    expect(result.data.nodes).toHaveLength(2);
    expect(result.data.nodes.find((n) => n.parentId === null)?.id).toBe(result.data.seedId);
    // Every read was fanned out against this audit id.
    expect(m(fetchProtocolRisksForAudit)).toHaveBeenCalledWith('a1');
    expect(m(fetchReportDraft)).toHaveBeenCalledWith('a1');
    expect(m(fetchFindingsReport)).toHaveBeenCalledWith('a1');
  });

  it('threads the findings report through the adapter (PR-D4)', async () => {
    m(fetchFindingsReport).mockResolvedValueOnce({
      report: {
        id: 'fr1',
        audit_id: 'a1',
        content: { intro_text: '…', closing_text: '…' },
        approval_status: 'DRAFT',
        approved_at: null,
        approved_by_name: null,
        updated_at: '2026-09-06T00:00:00Z',
        basis_digest: null,
        generation_refs: null,
        grounding_snapshot: null,
        generated_at: null,
      },
      failed: false,
    });
    const result = await fetchAuditLineage(AUDIT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.data.nodes.find((n) => n.entityType === 'FINDINGS_REPORT')?.objectId,
    ).toBe('fr1');
  });

  it('threads fetched objects through the adapter (a risk becomes a node)', async () => {
    m(fetchProtocolRisksForAudit).mockResolvedValueOnce([
      {
        id: 'r1',
        section_identifier: '5.3',
        section_title: 'ePRO data flow',
        endpoint_tier: 'PRIMARY',
        impact_surface: 'DATA_INTEGRITY',
        time_sensitivity: true,
        vendor_dependency_flags: [],
        operational_domain_tag: 'data_management',
        tagging_mode: 'MANUAL',
        version_change_type: 'ADDED',
        source_extracted_item_id: null,
      },
    ]);
    const result = await fetchAuditLineage(AUDIT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const risk = result.data.nodes.find((n) => n.entityType === 'PROTOCOL_RISK');
    expect(risk).toBeDefined();
    expect(risk?.parentId).toBe(result.data.nodes.find((n) => n.entityType === 'AUDIT')?.id);
  });

  it('returns ok:false (never throws) when a read rejects', async () => {
    m(fetchWorkspaceEntries).mockRejectedValueOnce(new Error('RLS denied'));
    const result = await fetchAuditLineage(AUDIT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('RLS denied');
  });
});
