// =============================================================================
// capaApi — Issues & CAPA reads + mutation RPC wrappers (Phase 3)
//
// A Stage 6 finding is triaged into an IssueObject; the issue carries at most
// one draft-only CapaObject (DRAFT → NEEDS_REVISION → ACCEPTED). "Accepted"
// means ready-to-export — never "approved"; formal CAPA finalization happens
// in the QMS after export.
//
// Reads: direct RLS-scoped SELECTs (rows are 1:1 TS mirrors — no flattening).
// Writes: audit_mode_* RPCs from 20260707000300_audit_mode_issue_capa_rpcs.sql
// — each mutation writes its state-history delta atomically server-side.
// Error contract matches the sibling APIs: console.error + null/[] so the UI
// degrades instead of throwing.
// =============================================================================

import { supabase } from '../supabase';
import type { CapaObject, CapaStatus, IssueObject, ProvisionalImpact } from '../../types/audit';
import type { MockWorkspaceEntry } from './mockWorkspaceEntries';

// ============================================================================
// Reads
// ============================================================================

export interface IssuesWithCapas {
  issues: IssueObject[];
  /** Keyed by issue_id — at most one CAPA per issue (DB UNIQUE). */
  capasByIssue: Record<string, CapaObject>;
}

export async function fetchIssuesWithCapas(auditId: string): Promise<IssuesWithCapas> {
  const [issuesRes, capasRes] = await Promise.all([
    supabase
      .from('issue_objects')
      .select('*')
      .eq('audit_id', auditId)
      .order('created_at', { ascending: true }),
    supabase.from('capa_objects').select('*').eq('audit_id', auditId),
  ]);

  if (issuesRes.error) {
    console.error('[capaApi] fetchIssuesWithCapas issues error:', issuesRes.error);
    return { issues: [], capasByIssue: {} };
  }
  if (capasRes.error) {
    console.error('[capaApi] fetchIssuesWithCapas capas error:', capasRes.error);
    return { issues: (issuesRes.data ?? []) as IssueObject[], capasByIssue: {} };
  }

  const capasByIssue: Record<string, CapaObject> = {};
  for (const capa of (capasRes.data ?? []) as CapaObject[]) {
    capasByIssue[capa.issue_id] = capa;
  }
  return { issues: (issuesRes.data ?? []) as IssueObject[], capasByIssue };
}

// ============================================================================
// Mutations (RPCs — atomic with delta tracking)
// ============================================================================

export interface CreateIssueInput {
  title: string;
  severity: ProvisionalImpact; // UI constrains to CRITICAL / MAJOR / MINOR
  description?: string;
  workspaceEntryId?: string | null;
  regulatoryReportable?: boolean;
  sponsorReportable?: boolean;
  reason?: string;
}

export async function createIssue(
  auditId: string,
  input: CreateIssueInput,
): Promise<IssueObject | null> {
  const { data, error } = await supabase.rpc('audit_mode_create_issue', {
    p_audit_id: auditId,
    p_title: input.title,
    p_severity: input.severity,
    p_description: input.description ?? '',
    p_workspace_entry_id: input.workspaceEntryId ?? null,
    p_regulatory_reportable: input.regulatoryReportable ?? false,
    p_sponsor_reportable: input.sponsorReportable ?? false,
    p_reason: input.reason ?? null,
  });

  if (error) {
    console.error('[capaApi] createIssue error:', error);
    return null;
  }
  return data as IssueObject;
}

// NB: no updateIssue wrapper — the UI has no issue-edit affordance yet, and
// per the working agreement we don't ship functions without callers. When
// issue editing lands, add the RPC + wrapper together (new migration).

export interface CreateCapaInput {
  rootCauseText?: string;
  correctiveActionText?: string;
  preventiveActionText?: string;
  piqcPrefilled?: boolean;
  reason?: string;
}

export async function createCapa(
  issueId: string,
  input: CreateCapaInput,
): Promise<CapaObject | null> {
  const { data, error } = await supabase.rpc('audit_mode_create_capa', {
    p_issue_id: issueId,
    p_root_cause_text: input.rootCauseText ?? '',
    p_corrective_action_text: input.correctiveActionText ?? '',
    p_preventive_action_text: input.preventiveActionText ?? '',
    p_piqc_prefilled: input.piqcPrefilled ?? false,
    p_reason: input.reason ?? null,
  });

  if (error) {
    console.error('[capaApi] createCapa error:', error);
    return null;
  }
  return data as CapaObject;
}

export interface UpdateCapaInput {
  rootCauseText?: string;
  correctiveActionText?: string;
  preventiveActionText?: string;
  reason?: string;
}

/** Text edits. Server-side: editing an ACCEPTED CAPA demotes it to DRAFT and
 *  any edit flips piqc_prefilled to FALSE (provenance honesty). */
export async function updateCapa(
  capaId: string,
  input: UpdateCapaInput,
): Promise<CapaObject | null> {
  const { data, error } = await supabase.rpc('audit_mode_update_capa', {
    p_id: capaId,
    p_root_cause_text: input.rootCauseText ?? null,
    p_corrective_action_text: input.correctiveActionText ?? null,
    p_preventive_action_text: input.preventiveActionText ?? null,
    p_reason: input.reason ?? null,
  });

  if (error) {
    console.error('[capaApi] updateCapa error:', error);
    return null;
  }
  return data as CapaObject;
}

export async function setCapaStatus(
  capaId: string,
  status: CapaStatus,
  reason?: string,
): Promise<CapaObject | null> {
  const { data, error } = await supabase.rpc('audit_mode_set_capa_status', {
    p_id: capaId,
    p_status: status,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[capaApi] setCapaStatus error:', error);
    return null;
  }
  return data as CapaObject;
}

/** Bookkeeping only — server rejects unless the CAPA is ACCEPTED. */
export async function markCapaExported(capaId: string): Promise<CapaObject | null> {
  const { data, error } = await supabase.rpc('audit_mode_mark_capa_exported', {
    p_id: capaId,
  });

  if (error) {
    console.error('[capaApi] markCapaExported error:', error);
    return null;
  }
  return data as CapaObject;
}

// ============================================================================
// PIQC prefill (pure)
//
// Templated skeleton from the triaged finding — same agentic pattern as the
// Stage 5 deliverable prefill (deterministic, human-reviewed; the auditor
// rewrites in place). LLM narrative drafting is a documented follow-up, like
// the exec-summary arc.
// ============================================================================

export interface CapaPrefill {
  rootCauseText: string;
  correctiveActionText: string;
  preventiveActionText: string;
}

export function buildCapaPrefillFromFinding(
  issueTitle: string,
  entry: MockWorkspaceEntry | null,
): CapaPrefill {
  const domain = entry?.vendor_domain?.trim();
  const observed = entry?.observation_text?.trim();
  const riskContext =
    entry?.inherited_endpoint_tier && entry?.inherited_impact_surface
      ? `The linked protocol risk is ${entry.inherited_endpoint_tier} tier with ${
          entry.inherited_impact_surface === 'BOTH'
            ? 'data-integrity and patient-safety'
            : entry.inherited_impact_surface === 'DATA_INTEGRITY'
              ? 'data-integrity'
              : 'patient-safety'
        } impact.`
      : '';

  return {
    rootCauseText: [
      `Observed: ${observed ?? issueTitle}`,
      riskContext,
      'Root cause to be confirmed with the vendor — describe the underlying process or system gap, not the symptom.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    correctiveActionText: domain
      ? `Correct the specific nonconformity observed in ${domain}: remediate the affected records/process and verify effectiveness with objective evidence.`
      : 'Correct the specific nonconformity observed: remediate the affected records/process and verify effectiveness with objective evidence.',
    preventiveActionText:
      'Prevent recurrence: identify other processes exposed to the same gap, update the controlling SOP/training, and define the effectiveness check (what will be measured, by when).',
  };
}
