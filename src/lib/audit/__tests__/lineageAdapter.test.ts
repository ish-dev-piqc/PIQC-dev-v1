import { describe, it, expect } from 'vitest';
import { buildLineageGraph, nodeDepth, type LineageInput } from '../lineageAdapter';
import type { AuditWithContext } from '../../../context/AuditContext';

// =============================================================================
// Lineage math regression tests. The graph's contract:
//   1. Exactly one seed (parentId null), and every node walks back to it.
//   2. Every edge's endpoints exist (no dangling references).
//   3. Cross-links and prefill provenance become edges with the right kind.
// =============================================================================

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

const EMPTY: LineageInput = {
  audit: AUDIT,
  risks: [],
  service: null,
  mappings: [],
  trust: null,
  questionnaire: null,
  riskSummary: null,
  preAudit: { confirmation_letter: null, agenda: null, checklist: null, internal_notification: null, evidence_gap_summary: null },
  entries: [],
  issues: [],
  capas: [],
  report: null,
  findingsReport: null,
};

function fullInput(): LineageInput {
  return {
    ...EMPTY,
    risks: [
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
    ],
    service: {
      id: 's1',
      audit_id: 'a1',
      service_name: 'ePRO platform',
      service_type: 'ePRO',
      service_description: null,
    },
    mappings: [
      {
        id: 'm1',
        vendor_service_id: 's1',
        protocol_risk_id: 'r1',
        derived_criticality: 'CRITICAL',
        criticality_rationale: null,
      },
    ],
    riskSummary: {
      id: 'rs1',
      audit_id: 'a1',
      study_context: {
        therapeutic_space: 'CNS',
        primary_endpoints: [],
        secondary_endpoints: [],
        clinical_trial_phase: 'PHASE_2',
        captured_at: '2026-06-01T00:00:00Z',
      },
      vendor_relevance_narrative: 'narrative',
      focus_areas: [],
      approval_status: 'APPROVED',
      approved_at: '2026-07-01T00:00:00Z',
      approved_by_name: 'QA Lead',
      protocol_risk_refs: [],
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
    },
    preAudit: {
      confirmation_letter: null,
      agenda: {
        id: 'ag1',
        audit_id: 'a1',
        content: { items: [] },
        approval_status: 'DRAFT',
        approved_by_name: null,
        approved_at: null,
        updated_at: '2026-07-01T10:00:00Z',
        source_risk_summary_id: 'rs1',
        prefilled_at: '2026-07-01T10:00:00Z',
      },
      checklist: null,
      internal_notification: {
        id: 'in1',
        audit_id: 'a1',
        content: { body_text: 'Internal heads-up.', scope: [] },
        approval_status: 'DRAFT',
        approved_by_name: null,
        approved_at: null,
        updated_at: '2026-09-04T00:00:00Z',
      },
      evidence_gap_summary: null,
    },
    entries: [
      {
        id: 'e1',
        audit_id: 'a1',
        protocol_risk_id: 'r1',
        vendor_service_mapping_id: 'm1',
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
      },
    ],
    report: {
      id: 'rep1',
      audit_id: 'a1',
      executive_summary: '…',
      conclusions: '…',
      approval_status: 'DRAFT',
      approved_at: null,
      approved_by_name: null,
      updated_at: '2026-07-02T00:00:00Z',
      final_signed_off_at: null,
      final_signed_off_by_name: null,
      exported_at: null,
      source_risk_summary_id: 'rs1',
    },
    findingsReport: {
      id: 'fr1',
      audit_id: 'a1',
      content: { intro_text: '…', closing_text: '…' },
      approval_status: 'DRAFT',
      approved_at: null,
      approved_by_name: null,
      updated_at: '2026-07-02T00:00:00Z',
      basis_digest: null,
      generation_refs: null,
      grounding_snapshot: null,
      generated_at: '2026-07-02T00:00:00Z',
    },
  };
}

describe('buildLineageGraph', () => {
  it('empty audit → exactly seed + audit, audit parented to seed', () => {
    const g = buildLineageGraph(EMPTY);
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(0);
    const seed = g.nodes.find((n) => n.parentId === null);
    expect(seed?.id).toBe(g.seedId);
    expect(seed?.entityType).toBe('AUDITEE');
    expect(g.nodes.find((n) => n.entityType === 'AUDIT')?.parentId).toBe(g.seedId);
  });

  it('every node walks back to the seed (no orphans)', () => {
    const g = buildLineageGraph(fullInput());
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    for (const node of g.nodes) {
      let cur = node;
      let hops = 0;
      while (cur.parentId !== null) {
        const parent = byId.get(cur.parentId);
        expect(parent, `${node.id} has dangling parent ${cur.parentId}`).toBeDefined();
        cur = parent as typeof cur;
        hops += 1;
        expect(hops).toBeLessThanOrEqual(g.nodes.length); // cycle guard
      }
      expect(cur.id).toBe(g.seedId);
    }
  });

  it('every edge has both endpoints in the node set', () => {
    const g = buildLineageGraph(fullInput());
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.fromId), `edge from ${e.fromId}`).toBe(true);
      expect(ids.has(e.toId), `edge to ${e.toId}`).toBe(true);
    }
  });

  it('cross-links become reference edges; prefill becomes provenance edges', () => {
    const g = buildLineageGraph(fullInput());
    const kinds = g.edges.map((e) => `${e.kind}:${e.label}`).sort();
    // mapping→risk, entry→risk, entry→mapping (references);
    // agenda→risk summary, report→risk summary (provenance).
    expect(kinds).toEqual([
      'provenance:prefilled from',
      'provenance:prefilled from',
      'reference:cites mapping',
      'reference:cites risk',
      'reference:maps to',
    ]);
  });

  it('drops edges whose target object is missing (deleted upstream)', () => {
    const input = fullInput();
    input.risks = []; // risk r1 gone; mapping + entry still reference it
    const g = buildLineageGraph(input);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.toId)).toBe(true);
    }
    // The two edges pointing at the deleted risk are gone; the rest survive.
    expect(g.edges.filter((e) => e.label === 'maps to')).toHaveLength(0);
    expect(g.edges.filter((e) => e.label === 'cites risk')).toHaveLength(0);
    expect(g.edges.filter((e) => e.label === 'cites mapping')).toHaveLength(1);
  });

  it('mapping nodes nest under the service, not the audit', () => {
    const g = buildLineageGraph(fullInput());
    const service = g.nodes.find((n) => n.entityType === 'VENDOR_SERVICE');
    const mapping = g.nodes.find((n) => n.entityType === 'SERVICE_MAPPING');
    expect(mapping?.parentId).toBe(service?.id);
    expect(g.nodes.filter((n) => n.parentId === service?.id)).toHaveLength(1);
    expect(nodeDepth(g, mapping!)).toBe(3); // seed → audit → service → mapping
  });

  it('the internal notification renders as a deliverable node with its tracked type (PR-D1)', () => {
    const g = buildLineageGraph(fullInput());
    const n = g.nodes.find((x) => x.entityType === 'INTERNAL_NOTIFICATION');
    expect(n?.title).toBe('Internal notification');
    expect(n?.trackedObjectType).toBe('INTERNAL_NOTIFICATION_OBJECT');
    // Never prefilled → drafted-in-stage origin, no provenance edges.
    expect(n?.origin).toBe('Drafted in Pre-audit drafting.');
    expect(g.edges.filter((e) => e.fromId === n?.id)).toHaveLength(0);
  });

  it('the evidence gap summary renders as a deliverable node with its tracked type (PR-D3)', () => {
    const input = fullInput();
    input.preAudit.evidence_gap_summary = {
      id: 'egs1',
      audit_id: 'a1',
      content: { body_text: 'Coverage per scope area.', scope: ['data_management'] },
      approval_status: 'DRAFT',
      approved_by_name: null,
      approved_at: null,
      updated_at: '2026-09-05T00:00:00Z',
    };
    const g = buildLineageGraph(input);
    const n = g.nodes.find((x) => x.entityType === 'EVIDENCE_GAP_SUMMARY');
    expect(n?.title).toBe('Evidence gap summary');
    expect(n?.trackedObjectType).toBe('EVIDENCE_GAP_SUMMARY_OBJECT');
    expect(n?.stage).toBe(5);
    // Never prefilled → drafted-in-stage origin, no provenance edges.
    expect(n?.origin).toBe('Drafted in Pre-audit drafting.');
    expect(g.edges.filter((e) => e.fromId === n?.id)).toHaveLength(0);
  });

  it('the findings report renders as a Stage-7 node with its tracked type and no edge fan (PR-D4)', () => {
    const g = buildLineageGraph(fullInput());
    const n = g.nodes.find((x) => x.entityType === 'FINDINGS_REPORT');
    expect(n).toMatchObject({
      title: 'Findings report',
      stage: 7,
      trackedObjectType: 'FINDINGS_REPORT_OBJECT',
      objectId: 'fr1',
    });
    // Generated → PIQC origin line; blocks always declared live-derived.
    expect(n?.origin).toContain('PIQC drafted the connective narrative');
    // No per-entry provenance fan by design — the blocks derive from the
    // ENTIRE Stage-6 entry set.
    expect(g.edges.filter((e) => e.fromId === n?.id)).toHaveLength(0);
  });

  it('every stage object carries a trackedObjectType for history lookups', () => {
    const g = buildLineageGraph(fullInput());
    const untracked = g.nodes.filter((n) => n.entityType !== 'AUDITEE' && !n.trackedObjectType);
    expect(untracked).toEqual([]);
  });
});

// =============================================================================
// Issues & CAPA layer (Phase 3) — triage lineage off Stage 6.
// =============================================================================
describe('buildLineageGraph — issues & CAPA', () => {
  const ISSUE = {
    id: 'i1',
    audit_id: 'a1',
    workspace_entry_id: 'e1',
    title: 'Incomplete CSV evidence',
    description: '',
    severity: 'MAJOR' as const,
    regulatory_reportable: true,
    sponsor_reportable: false,
    created_by: 'u1',
    created_at: '2026-07-02T00:00:00Z',
    updated_at: '2026-07-02T00:00:00Z',
  };
  const CAPA = {
    id: 'c1',
    issue_id: 'i1',
    audit_id: 'a1',
    root_cause_text: 'draft',
    corrective_action_text: 'draft',
    preventive_action_text: 'draft',
    status: 'DRAFT' as const,
    piqc_prefilled: true,
    accepted_at: null,
    accepted_by: null,
    exported_at: null,
    created_by: 'u1',
    created_at: '2026-07-02T00:00:00Z',
    updated_at: '2026-07-02T00:00:00Z',
  };

  it('issue nests under its finding; CAPA nests under the issue; provenance edge to the finding', () => {
    const input = { ...fullInput(), issues: [ISSUE], capas: [CAPA] };
    const g = buildLineageGraph(input);
    const entry = g.nodes.find((n) => n.entityType === 'WORKSPACE_ENTRY');
    const issue = g.nodes.find((n) => n.entityType === 'ISSUE');
    const capa = g.nodes.find((n) => n.entityType === 'CAPA');
    expect(issue?.parentId).toBe(entry?.id);
    expect(capa?.parentId).toBe(issue?.id);
    expect(issue?.origin).toContain('regulatory-reportable');
    // PIQC-prefilled CAPA carries a provenance edge back to the source finding.
    expect(
      g.edges.some(
        (e) => e.fromId === capa?.id && e.toId === entry?.id && e.kind === 'provenance',
      ),
    ).toBe(true);
    // Both are history-tracked.
    expect(issue?.trackedObjectType).toBe('ISSUE_OBJECT');
    expect(capa?.trackedObjectType).toBe('CAPA_OBJECT');
  });

  it('issue falls back to the audit parent when its source finding is gone (no orphans)', () => {
    const input = { ...fullInput(), entries: [], issues: [ISSUE], capas: [CAPA] };
    const g = buildLineageGraph(input);
    const auditNode = g.nodes.find((n) => n.entityType === 'AUDIT');
    const issue = g.nodes.find((n) => n.entityType === 'ISSUE');
    expect(issue?.parentId).toBe(auditNode?.id);
    // The prefill provenance edge to the deleted finding is dropped, not dangled.
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.fromId)).toBe(true);
      expect(ids.has(e.toId)).toBe(true);
    }
  });

  it('a CAPA whose issue is missing is skipped entirely', () => {
    const input = { ...fullInput(), issues: [], capas: [CAPA] };
    const g = buildLineageGraph(input);
    expect(g.nodes.find((n) => n.entityType === 'CAPA')).toBeUndefined();
  });
});
