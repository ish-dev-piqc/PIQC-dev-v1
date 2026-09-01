// =============================================================================
// lineageApi — fetch composition for the traceability drawer.
//
// No new backend surface: composes the EXISTING per-audit read APIs (each
// already RLS-scoped and null-tolerant) in parallel, then hands the results to
// the pure lineageAdapter. If an individual read fails it resolves to its empty
// shape (the underlying APIs console.error internally), so the graph degrades
// to "fewer nodes" rather than failing wholesale — a partially-hydrated lineage
// is still true, just incomplete.
// =============================================================================

import type { AuditWithContext } from '../../context/AuditContext';
import { fetchProtocolRisksForAudit } from './intakeApi';
import {
  fetchVendorService,
  fetchServiceMappingsByAudit,
  fetchTrustAssessment,
} from './vendorEnrichmentApi';
import { fetchQuestionnaireBundle } from './questionnaireApi';
import { fetchRiskSummary } from './riskSummaryApi';
import { fetchPreAuditDeliverables } from './preAuditApi';
import { fetchWorkspaceEntries } from './workspaceEntriesApi';
import { fetchIssuesWithCapas } from './capaApi';
import { fetchReportDraft } from './reportApi';
import { fetchFindingsReport } from './findingsReport';
import { buildLineageGraph, type LineageGraph } from './lineageAdapter';

export type LineageResult =
  | { ok: true; data: LineageGraph }
  | { ok: false; error: string };

export async function fetchAuditLineage(audit: AuditWithContext): Promise<LineageResult> {
  try {
    const [
      risks,
      service,
      mappings,
      trust,
      questionnaire,
      riskSummary,
      preAudit,
      entries,
      issuesWithCapas,
      report,
      findingsReportFetch,
    ] = await Promise.all([
      fetchProtocolRisksForAudit(audit.id),
      // Result-carrying reads (PR-2): the drawer renders what it can see —
      // a failed read is omitted like an absent one (ledgered).
      fetchVendorService(audit.id).then((r) => (r.ok ? r.data : null)),
      fetchServiceMappingsByAudit(audit.id).then((r) => (r.ok ? r.data : [])),
      fetchTrustAssessment(audit.id).then((r) => (r.ok ? r.data : null)),
      fetchQuestionnaireBundle(audit.id),
      fetchRiskSummary(audit.id),
      // Lineage renders what it can see; a failed kind is omitted from the
      // graph like an absent one (ledgered — the drawer has no error surface).
      fetchPreAuditDeliverables(audit.id).then((r) => r.bundle),
      fetchWorkspaceEntries(audit.id),
      fetchIssuesWithCapas(audit.id),
      fetchReportDraft(audit.id),
      // Failed read → omitted like an absent one (same ledgered drawer rule).
      fetchFindingsReport(audit.id),
    ]);

    return {
      ok: true,
      data: buildLineageGraph({
        audit,
        risks,
        service,
        mappings,
        trust,
        questionnaire,
        riskSummary,
        preAudit,
        entries,
        issues: issuesWithCapas.issues,
        capas: Object.values(issuesWithCapas.capasByIssue),
        report,
        findingsReport: findingsReportFetch.report,
      }),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not load the audit lineage.',
    };
  }
}
